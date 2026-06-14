import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GraphQuery } from '../src/query/graph_query.js';
import { GraphEdge } from '../src/schema/edge.js';
import { GraphNode } from '../src/schema/node.js';
import { GraphReportData, ReportData } from '../src/report/report_data.js';
import { KuzuStore } from '../src/store/kuzu_store.js';

/**
 * A small graph with a linear chain `a → b → c`, a mutually-recursive pair
 * `x ↔ y` (one call cycle), and an exported-but-unreferenced `dead`. It exercises
 * composition counts, semantic detection, static cycle detection, and dead-export
 * gathering without any runtime data, so the runtime sections stay empty.
 */
const fn = (name: string, file: string, line: number, exported: boolean): GraphNode => ({
	id: `Function:${file}#${name}@${line}`,
	kind: 'Function',
	name,
	filePath: file,
	range: { startLine: line, startColumn: 0, endLine: line + 2, endColumn: 1 },
	exported,
	metadata: {},
});

const calls = (from: string, to: string): GraphEdge => ({
	id: `CALLS:${from}->${to}`,
	kind: 'CALLS',
	from,
	to,
	metadata: { count: 1 },
});

const A = fn('a', 'src/a.ts', 1, false);
const B = fn('b', 'src/a.ts', 10, true);
const C = fn('c', 'src/b.ts', 20, true);
const DEAD = fn('dead', 'src/b.ts', 30, true);
const X = fn('x', 'src/c.ts', 1, false);
const Y = fn('y', 'src/c.ts', 10, false);

const NODES: GraphNode[] = [A, B, C, DEAD, X, Y];
const EDGES: GraphEdge[] = [calls(A.id, B.id), calls(B.id, C.id), calls(X.id, Y.id), calls(Y.id, X.id)];

const withData = async (assertion: (data: GraphReportData) => void): Promise<void> => {
	const dir = await mkdtemp(join(tmpdir(), 'tkg-report-'));
	const store = new KuzuStore(join(dir, 'graph.kuzu'));
	await store.initSchema();
	await store.load(NODES, EDGES);
	try {
		const data = await ReportData.gather(store, new GraphQuery(store), {
			generatedAt: '2026-01-01',
			project: 'test-proj',
			outputFolder: './out',
			limit: 10,
		});
		assertion(data);
	} finally {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	}
};

describe('ReportData.gather', () => {
	it('summarises composition and flags a semantic, un-enriched graph', async () => {
		await withData((data) => {
			assert.equal(data.semantic, true);
			assert.equal(data.enriched, false);
			assert.equal(data.totals.symbols, 6);
			assert.equal(data.totals.files, 3);
			assert.equal(data.totals.relationships, 4);
			assert.deepEqual(data.nodeKinds, [{ kind: 'Function', count: 6 }]);
			assert.deepEqual(data.edgeKinds, [{ kind: 'CALLS', count: 4 }]);
			assert.equal(data.hotspots.length, 0);
			assert.equal(data.cost.length, 0);
			assert.equal(data.provenance, null);
			assert.equal(data.project, 'test-proj');
		});
	});

	it('detects the call cycle and the dead export', async () => {
		await withData((data) => {
			assert.equal(data.totals.cycles, 1);
			assert.equal(data.cycles[0].size, 2);
			assert.deepEqual(data.cycles[0].members.map((member) => member.name).sort(), ['x', 'y']);
			assert.equal(data.deadExports.length, 1);
			assert.equal(data.deadExports[0].name, 'dead');
		});
	});

	it('leaves the runtime synthesis and communities empty without enrichment', async () => {
		await withData((data) => {
			assert.deepEqual(data.structureVsRuntime, { orchestrators: [], hiddenHotspots: [], alignedCore: [] });
			assert.equal(data.communities.length, 0);
			assert.equal(data.totals.communities, 0);
		});
	});
});
