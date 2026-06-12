import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { z } from 'zod';
import { BenchmarkDelta, BenchmarkStats } from '../benchmark/benchmark_stats.js';
import { BenchmarkMetric, BenchmarkReport, NodeBenchmark } from '../benchmark/node_benchmark.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH } from './command_helpers.js';

type BenchmarkCommandOptions = {
	db: string;
	root: string;
	workload: string;
	by: string;
	runs: string;
	baseline?: string;
	saveBaseline?: string;
	json?: boolean;
};

const METRICS: BenchmarkMetric[] = ['self-time', 'inclusive-time', 'samples'];

/** A saved baseline is just a prior report; we only need its median back. */
const BaselineFileSchema = z.object({ stats: z.object({ median: z.number() }) });

export class BenchmarkCommand {
	static register(program: Command): void {
		program
			.command('benchmark')
			.description('measure a target node\'s runtime metric over N profiling runs and report the median + spread (advisory)')
			.argument('<target>', 'symbol name to benchmark; resolved against the current graph like `find`')
			.requiredOption('--workload <path>', 'repeatable workload entry (.ts/.js) that exercises the target under load')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('-r, --root <path>', 'project root the profile paths resolve against', process.cwd())
			.option('--by <metric>', `metric: ${METRICS.join(', ')}`, 'self-time')
			.option('--runs <n>', 'number of profiling runs to take the median of', '5')
			.option('--baseline <file>', 'compare against the median saved in this baseline file (advisory delta)')
			.option('--save-baseline <file>', 'write this run as a baseline for a later --baseline comparison')
			.option('--json', 'emit the benchmark report as JSON', false)
			.action(async (target: string, options: BenchmarkCommandOptions) => {
				if (METRICS.includes(options.by as BenchmarkMetric) === false) {
					console.error(chalk.red(`unknown metric '${options.by}' — choose one of: ${METRICS.join(', ')}`));
					process.exitCode = 1;
					return;
				}
				await BenchmarkCommand.run(target, options);
			});
	}

	private static async run(target: string, options: BenchmarkCommandOptions): Promise<void> {
		const store = new KuzuStore(resolve(options.db));
		await store.initSchema();
		const profileDir = await mkdtemp(join(tmpdir(), 'tkg-bench-'));
		try {
			const baselineMedian = options.baseline === undefined ? undefined : await BenchmarkCommand.readBaselineMedian(options.baseline);
			const config = { workload: resolve(options.workload), root: resolve(options.root), profileDir };
			const report = await NodeBenchmark.measure(
				store,
				{ target, metric: options.by as BenchmarkMetric, runs: Number(options.runs), baselineMedian },
				() => NodeBenchmark.profileAndEnrich(store, config),
			);
			if (options.saveBaseline !== undefined) {
				await BenchmarkCommand.writeBaseline(options.saveBaseline, report);
			}
			BenchmarkCommand.print(report, options.json === true);
		} finally {
			await store.close();
			await rm(profileDir, { recursive: true, force: true });
		}
	}

	private static async readBaselineMedian(file: string): Promise<number> {
		const parsed = BaselineFileSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8')));
		return parsed.stats.median;
	}

	private static async writeBaseline(file: string, report: BenchmarkReport): Promise<void> {
		const path = resolve(file);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
	}

	private static print(report: BenchmarkReport, json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		const target = report.target;
		console.log(chalk.bold(target.name) + chalk.gray(`  ${target.kind} · ${target.filePath}:${target.startLine}`));

		const stats = report.stats;
		const median = chalk.cyan(`${BenchmarkCommand.round(stats.median)} ${report.unit}`);
		const spread = chalk.gray(
			`(min ${BenchmarkCommand.round(stats.min)} · max ${BenchmarkCommand.round(stats.max)} · ` +
			`spread ${BenchmarkCommand.round(stats.spread)} · mean ${BenchmarkCommand.round(stats.mean)} · ${stats.runs} runs)`,
		);
		console.log(`  ${chalk.bold(report.metric)}  median ${median}   ${spread}`);

		if (report.delta !== null) {
			BenchmarkCommand.printDelta(report, report.delta);
		}
		console.log(chalk.yellow(`  ${report.advisory}`));
	}

	private static printDelta(report: BenchmarkReport, delta: BenchmarkDelta): void {
		const direction = BenchmarkStats.direction(delta, report.stats.spread);
		const colour = direction === 'improved' ? chalk.green : direction === 'regressed' ? chalk.red : chalk.gray;
		const absolute = `${delta.absolute > 0 ? '+' : ''}${BenchmarkCommand.round(delta.absolute)} ${report.unit}`;
		const percent = BenchmarkStats.formatPercent(delta.percent);
		console.log(`  ${chalk.bold('Δ vs baseline')}  ${colour(`${absolute}  (${percent})`)}  ${colour(direction)}`);
	}

	private static round(value: number): number {
		return Math.round(value * 1000) / 1000;
	}
}
