import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RuntimeEnricher } from '../enrich/runtime_enricher.js';
import { CostMetric, GraphQuery } from '../query/graph_query.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { BenchmarkDelta, BenchmarkStats, BenchmarkStatsSummary } from './benchmark_stats.js';

/**
 * The benchmark gate: measure one target node's runtime metric over a repeatable
 * workload, **before and after** an edit, and report the delta. It reuses the
 * existing machinery end to end — a V8 CPU profile feeds {@link RuntimeEnricher}
 * (the same `enrich` path) and the metric is read back through
 * {@link GraphQuery.costAttribution} (the `cost` query).
 *
 * Honesty about noise is baked in: a benchmark runs the workload N times and
 * reports the **median + spread**, and a baseline comparison is labelled
 * **advisory** — distinct from the hard pass/fail of the `verify` gate. The
 * profiling step is injected ({@link ProfileRun}) so the read + statistics logic
 * is unit-tested without actually profiling.
 */

/** Which runtime metric to track. `self-time` is the node's own exclusive time; `inclusive-time` adds its callees. */
export type BenchmarkMetric = 'self-time' | 'inclusive-time' | 'samples';

export type BenchmarkTarget = {
	id: string;
	name: string;
	kind: string;
	filePath: string;
	startLine: number;
};

export type BenchmarkReport = {
	target: BenchmarkTarget;
	metric: BenchmarkMetric;
	unit: 'ms' | 'samples';
	stats: BenchmarkStatsSummary;
	/** Present only when a prior baseline median was supplied; always advisory. */
	delta: BenchmarkDelta | null;
	/** A human note stating the result is advisory and noisy, not a guarantee. */
	advisory: string;
};

export type NodeBenchmarkOptions = {
	/** Symbol name (or substring / kind) resolved against the current graph to pick the target node. */
	target: string;
	/** Default `self-time`. */
	metric?: BenchmarkMetric;
	/** Number of profiling runs. Default 5, clamped to [1, 50]. */
	runs?: number;
	/** A prior baseline median to compare the current median against (advisory delta). */
	baselineMedian?: number;
};

/** Everything one real profiling run needs: the workload entry, the project root, and a scratch dir for `.cpuprofile`s. */
export type ProfileConfig = {
	/** Path to a repeatable workload entry (a `.ts`/`.js` file) that exercises the target under load. */
	workload: string;
	/** Project root the profile's absolute frame paths resolve against (passed to `enrich`). */
	root: string;
	/** Scratch directory for the per-run `.cpuprofile`. */
	profileDir: string;
};

/** One profiling run: leave a fresh `metadata.runtime` on the graph in the store. Injectable so tests skip profiling. */
export type ProfileRun = (run: number) => Promise<void>;

const DEFAULT_RUNS = 5;
const MIN_RUNS = 1;
const MAX_RUNS = 50;

export class NodeBenchmark {
	/**
	 * Profile the workload `runs` times, reading the target's metric after each,
	 * and return the median + spread (plus an advisory delta when a baseline is
	 * given). `profileRun` defaults to a real V8 profile + enrich; tests inject a
	 * fake that writes a known metric so this method's read/stats logic is covered
	 * without profiling.
	 */
	static async measure(store: KuzuStore, options: NodeBenchmarkOptions, profileRun: ProfileRun): Promise<BenchmarkReport> {
		const query = new GraphQuery(store);
		const target = await NodeBenchmark.resolveTarget(query, options.target);
		const metric = options.metric ?? 'self-time';
		const runs = NodeBenchmark.clampRuns(options.runs ?? DEFAULT_RUNS);

		const values: number[] = [];
		for (let run = 0; run < runs; run += 1) {
			await profileRun(run);
			values.push(await NodeBenchmark.readMetric(query, target.id, metric));
		}

		const stats = BenchmarkStats.summarize(values);
		const delta = options.baselineMedian === undefined
			? null
			: BenchmarkStats.delta(options.baselineMedian, stats.median);
		const unit: 'ms' | 'samples' = metric === 'samples' ? 'samples' : 'ms';
		return { target, metric, unit, stats, delta, advisory: NodeBenchmark.buildAdvisory(stats, unit) };
	}

	/** Resolve a target name to exactly one node in the current graph, or throw with guidance. */
	static async resolveTarget(query: GraphQuery, target: string): Promise<BenchmarkTarget> {
		const matches = await query.find(target);
		if (matches.length === 0) {
			throw new Error(`no node matches "${target}" — resolve a symbol name with \`find\` first`);
		}
		const exact = matches.filter((match) => match.name === target);
		const chosen = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
		if (chosen === null) {
			const candidates = (exact.length > 0 ? exact : matches).slice(0, 8).map((match) => match.id).join(', ');
			throw new Error(`"${target}" is ambiguous — narrow it to one of: ${candidates}`);
		}
		return { id: chosen.id, name: chosen.name, kind: chosen.kind, filePath: chosen.filePath, startLine: chosen.startLine };
	}

	/** Read the target's current metric via the cost model (the `cost` query). */
	static async readMetric(query: GraphQuery, id: string, metric: BenchmarkMetric): Promise<number> {
		const by: CostMetric = metric === 'samples' ? 'samples' : 'self-time';
		const attribution = await query.costAttribution(id, { by });
		if (attribution.node === null) {
			throw new Error(`target node ${id} is no longer in the graph — rebuild after the edit`);
		}
		return metric === 'inclusive-time' ? attribution.node.inclusiveCost : attribution.node.selfCost;
	}

	/** A real profiling run: V8-profile the workload, then enrich the graph with the measured self time. */
	static async profileAndEnrich(store: KuzuStore, config: ProfileConfig): Promise<void> {
		await rm(config.profileDir, { recursive: true, force: true });
		await mkdir(config.profileDir, { recursive: true });
		const profilePath = await NodeBenchmark.runWorkload(config);
		const profileText = await readFile(profilePath, 'utf8');
		await RuntimeEnricher.enrich(store, profileText, { root: config.root });
	}

	private static clampRuns(runs: number): number {
		if (Number.isFinite(runs) === false) {
			return DEFAULT_RUNS;
		}
		return Math.min(MAX_RUNS, Math.max(MIN_RUNS, Math.floor(runs)));
	}

	private static buildAdvisory(stats: BenchmarkStatsSummary, unit: 'ms' | 'samples'): string {
		const spread = `${NodeBenchmark.round(stats.spread)} ${unit}`;
		return (
			`Advisory — runtime measurement is noisy. This is the median of ${stats.runs} run(s) ` +
			`(spread ${spread}), not a deterministic guarantee. Unlike the verify gate (hard pass/fail), ` +
			`a benchmark delta is indicative, not proof.`
		);
	}

	private static round(value: number): number {
		return Math.round(value * 1000) / 1000;
	}

	private static runWorkload(config: ProfileConfig): Promise<string> {
		return new Promise((resolvePromise, reject) => {
			const args = ['--cpu-prof', '--cpu-prof-dir', config.profileDir, '--import', 'tsx', config.workload];
			const child = spawn('node', args, { cwd: config.root, stdio: ['ignore', 'ignore', 'pipe'] });
			let stderr = '';
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on('error', reject);
			child.on('close', (code) => {
				if (code !== 0) {
					reject(new Error(`workload "${config.workload}" exited with code ${code}\n${stderr.trim()}`));
					return;
				}
				NodeBenchmark.newestProfile(config.profileDir).then(resolvePromise, reject);
			});
		});
	}

	private static async newestProfile(profileDir: string): Promise<string> {
		const entries = (await readdir(profileDir)).filter((name) => name.endsWith('.cpuprofile'));
		if (entries.length === 0) {
			throw new Error(`no .cpuprofile written to ${profileDir} — did the workload run under --cpu-prof?`);
		}
		const withMtime = await Promise.all(
			entries.map(async (name) => {
				const path = join(profileDir, name);
				return { path, mtimeMs: (await stat(path)).mtimeMs };
			}),
		);
		withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return withMtime[0].path;
	}
}
