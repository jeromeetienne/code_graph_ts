import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CpuProfile } from '../src/enrich/cpu_profile.js';
import { RuntimeJoin, RuntimeTargetNode } from '../src/enrich/runtime_join.js';
import { GraphQuery } from '../src/query/graph_query.js';
import { GraphEdge } from '../src/schema/edge.js';
import { GraphNode } from '../src/schema/node.js';
import { KuzuStore } from '../src/store/kuzu_store.js';

const ROOT = '/proj';

/** A nested call tree (root) → main → hot → cold, sampled via hitCount (no samples array) for determinism. */
const NESTED_PROFILE = JSON.stringify({
	nodes: [
		{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
		{ id: 2, callFrame: { functionName: 'main', url: 'file:///proj/src/a.ts', lineNumber: 1, columnNumber: 2 }, hitCount: 0, children: [3] },
		{ id: 3, callFrame: { functionName: 'hot', url: 'file:///proj/src/a.ts', lineNumber: 4, columnNumber: 2 }, hitCount: 3, children: [4] },
		{ id: 4, callFrame: { functionName: 'cold', url: 'file:///proj/src/a.ts', lineNumber: 11, columnNumber: 2 }, hitCount: 2 },
	],
});

const NODES: RuntimeTargetNode[] = [
	{ id: 'Function:src/a.ts#main@1', kind: 'Function', name: 'main', filePath: 'src/a.ts', startLine: 1, endLine: 1 },
	{ id: 'Function:src/a.ts#hot@4', kind: 'Function', name: 'hot', filePath: 'src/a.ts', startLine: 4, endLine: 8 },
	{ id: 'Function:src/a.ts#cold@11', kind: 'Function', name: 'cold', filePath: 'src/a.ts', startLine: 11, endLine: 14 },
];

describe('CpuProfile.callEdges', () => {
	it('extracts parent -> child edges weighted by callee subtree samples', () => {
		const edges = CpuProfile.callEdges(CpuProfile.parse(NESTED_PROFILE));
		assert.equal(edges.length, 3); // (root)->main, main->hot, hot->cold
		const byCallee = new Map(edges.map((edge) => [edge.callee.functionName, edge.samples]));
		assert.equal(byCallee.get('cold'), 2); // cold subtree = its own 2 samples
		assert.equal(byCallee.get('hot'), 5); // hot subtree = 3 + cold's 2
		assert.equal(byCallee.get('main'), 5); // main subtree = 0 + hot's 5
	});
});

describe('RuntimeJoin.joinCallEdges', () => {
	it('resolves both endpoints to node ids and drops unresolved callers', () => {
		const edges = CpuProfile.callEdges(CpuProfile.parse(NESTED_PROFILE));
		const result = RuntimeJoin.joinCallEdges(NODES, edges, { root: ROOT });
		assert.equal(result.matchedEdges, 2); // main->hot, hot->cold
		assert.equal(result.droppedEdges, 1); // (root)->main: (root) has no file
		const byPair = new Map(result.edges.map((edge) => [`${edge.from} ${edge.to}`, edge.samples]));
		assert.equal(byPair.get('Function:src/a.ts#main@1 Function:src/a.ts#hot@4'), 5);
		assert.equal(byPair.get('Function:src/a.ts#hot@4 Function:src/a.ts#cold@11'), 2);
	});

	it('drops self-edges from recursion', () => {
		const recursive = JSON.stringify({
			nodes: [
				{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
				{ id: 2, callFrame: { functionName: 'hot', url: 'file:///proj/src/a.ts', lineNumber: 4, columnNumber: 2 }, hitCount: 1, children: [3] },
				{ id: 3, callFrame: { functionName: 'hot', url: 'file:///proj/src/a.ts', lineNumber: 4, columnNumber: 2 }, hitCount: 2 },
			],
		});
		const edges = CpuProfile.callEdges(CpuProfile.parse(recursive));
		const result = RuntimeJoin.joinCallEdges(NODES, edges, { root: ROOT });
		assert.equal(result.matchedEdges, 0); // (root)->hot dropped, hot->hot is a self-edge
		assert.equal(result.edges.length, 0);
	});
});

describe('KuzuStore runtime call edges', () => {
	let dir: string;
	let store: KuzuStore;

	const HOT_ID = 'Function:src/a.ts#hot@4';
	const COLD_ID = 'Function:src/a.ts#cold@11';

	const GRAPH_NODES: GraphNode[] = [
		{ id: HOT_ID, kind: 'Function', name: 'hot', filePath: 'src/a.ts', range: { startLine: 4, startColumn: 0, endLine: 8, endColumn: 1 } },
		{ id: COLD_ID, kind: 'Function', name: 'cold', filePath: 'src/a.ts', range: { startLine: 11, startColumn: 0, endLine: 14, endColumn: 1 } },
	];

	const RUNTIME_EDGE: GraphEdge = {
		id: `CALLS_RUNTIME:${HOT_ID}->${COLD_ID}`,
		kind: 'CALLS_RUNTIME',
		from: HOT_ID,
		to: COLD_ID,
		metadata: { source: 'v8-cpuprofile', samples: 2 },
	};

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'tkg-calledge-'));
		store = new KuzuStore(join(dir, 'graph.kuzu'));
		await store.initSchema();
		await store.load(GRAPH_NODES, []);
	});

	afterEach(async () => {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('writes a CALLS_RUNTIME edge a neighbourhood query reads back', async () => {
		await store.writeEdges([RUNTIME_EDGE]);
		const neighbours = await new GraphQuery(store).neighborhood(HOT_ID);
		const runtime = neighbours.find((neighbour) => neighbour.edgeKind === 'CALLS_RUNTIME');
		assert.notEqual(runtime, undefined);
		assert.equal(runtime?.id, COLD_ID);
		assert.equal(runtime?.direction, 'out');
		assert.equal(runtime?.edgeMetadata.samples, 2);
	});

	it('clears prior runtime edges by kind', async () => {
		await store.writeEdges([RUNTIME_EDGE]);
		await store.clearEdgesByKind('CALLS_RUNTIME');
		const neighbours = await new GraphQuery(store).neighborhood(HOT_ID);
		assert.equal(neighbours.length, 0);
	});
});
