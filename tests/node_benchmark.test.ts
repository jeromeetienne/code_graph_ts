import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { NodeBenchmark } from '../src/benchmark/node_benchmark.js';
import { GraphEdge } from '../src/schema/edge.js';
import { GraphNode } from '../src/schema/node.js';
import { KuzuStore } from '../src/store/kuzu_store.js';

const symbolId = (name: string, line: number): string => `Function:src/a.ts#${name}@${line}`;

const fn = (name: string, line: number, selfMs?: number): GraphNode => ({
	id: symbolId(name, line),
	kind: 'Function',
	name,
	filePath: 'src/a.ts',
	range: { startLine: line, startColumn: 0, endLine: line + 3, endColumn: 1 },
	exported: true,
	metadata: selfMs === undefined ? {} : { runtime: { source: 'v8-cpuprofile', selfMs, samples: selfMs } },
});

const callEdge = (from: string, fromLine: number, to: string, toLine: number): GraphEdge => ({
	id: `CALLS:${from}->${to}`,
	kind: 'CALLS',
	from: symbolId(from, fromLine),
	to: symbolId(to, toLine),
	metadata: { count: 1 },
});

const noop = async (): Promise<void> => {};

async function withStore(nodes: GraphNode[], edges: GraphEdge[], body: (store: KuzuStore) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), 'tkg-bench-test-'));
	const store = new KuzuStore(join(dir, 'graph.kuzu'));
	await store.initSchema();
	await store.load(nodes, edges);
	try {
		await body(store);
	} finally {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	}
}

describe('NodeBenchmark.measure', () => {
	it('resolves the target by name and takes the median self-time across runs', async () => {
		await withStore([fn('titleCase', 5)], [], async (store) => {
			const sequence = [10, 12, 11, 13, 9];
			const profileRun = async (run: number): Promise<void> => {
				await store.writeNodeMetadata([
					{ id: symbolId('titleCase', 5), metadata: { runtime: { source: 'v8-cpuprofile', selfMs: sequence[run], samples: sequence[run] } } },
				]);
			};
			const report = await NodeBenchmark.measure(store, { target: 'titleCase', runs: 5 }, profileRun);
			assert.equal(report.target.name, 'titleCase');
			assert.equal(report.metric, 'self-time');
			assert.equal(report.unit, 'ms');
			assert.equal(report.stats.runs, 5);
			assert.equal(report.stats.median, 11);
			assert.equal(report.stats.min, 9);
			assert.equal(report.stats.max, 13);
			assert.equal(report.stats.spread, 4);
			assert.equal(report.delta, null);
			assert.match(report.advisory, /Advisory/);
		});
	});

	it('reports an advisory delta against a provided baseline median', async () => {
		await withStore([fn('titleCase', 5, 12)], [], async (store) => {
			const report = await NodeBenchmark.measure(store, { target: 'titleCase', runs: 3, baselineMedian: 20 }, noop);
			assert.equal(report.stats.median, 12);
			assert.notEqual(report.delta, null);
			assert.equal(report.delta?.absolute, -8);
			assert.equal(Math.round((report.delta?.percent ?? 0) * 100) / 100, -0.4);
		});
	});

	it('reads inclusive time (self + callees) when asked', async () => {
		const nodes = [fn('caller', 1, 2), fn('callee', 10, 10)];
		await withStore(nodes, [callEdge('caller', 1, 'callee', 10)], async (store) => {
			const self = await NodeBenchmark.measure(store, { target: 'caller', runs: 1, metric: 'self-time' }, noop);
			assert.equal(self.stats.median, 2);
			const inclusive = await NodeBenchmark.measure(store, { target: 'caller', runs: 1, metric: 'inclusive-time' }, noop);
			assert.equal(inclusive.stats.median, 12);
			assert.equal(inclusive.unit, 'ms');
		});
	});

	it('tracks the samples metric with a samples unit', async () => {
		await withStore([fn('hot', 5, 7)], [], async (store) => {
			const report = await NodeBenchmark.measure(store, { target: 'hot', runs: 1, metric: 'samples' }, noop);
			assert.equal(report.unit, 'samples');
			assert.equal(report.stats.median, 7);
		});
	});

	it('clamps a runs count below 1 up to a single run', async () => {
		await withStore([fn('hot', 5, 3)], [], async (store) => {
			const report = await NodeBenchmark.measure(store, { target: 'hot', runs: 0 }, noop);
			assert.equal(report.stats.runs, 1);
		});
	});

	it('fails clearly when the target is not in the graph', async () => {
		await withStore([fn('titleCase', 5, 1)], [], async (store) => {
			await assert.rejects(NodeBenchmark.measure(store, { target: 'missing', runs: 1 }, noop), /no node matches/);
		});
	});

	it('refuses an ambiguous target rather than guessing', async () => {
		await withStore([fn('parseA', 1, 1), fn('parseB', 10, 1)], [], async (store) => {
			await assert.rejects(NodeBenchmark.measure(store, { target: 'parse', runs: 1 }, noop), /ambiguous/);
		});
	});
});
