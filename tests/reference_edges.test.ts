import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GraphQuery } from '../src/query/graph_query.js';
import { EDGE_KINDS, GraphEdge, REFERENCE_EDGE_KINDS } from '../src/schema/edge.js';
import { GraphNode } from '../src/schema/node.js';
import { KuzuStore } from '../src/store/kuzu_store.js';

const referenceSet = new Set<string>(REFERENCE_EDGE_KINDS);

describe('REFERENCE_EDGE_KINDS', () => {
	it('counts uses — calls, heritage, type mentions, reads, and overrides', () => {
		for (const kind of ['CALLS', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE', 'RETURNS', 'PARAM_TYPE', 'INSTANTIATES', 'READS', 'OVERRIDES']) {
			assert.ok(referenceSet.has(kind), `expected ${kind} to be a reference`);
		}
	});

	it('excludes structural, mutation, and system-level edges', () => {
		for (const kind of ['CONTAINS', 'IMPORTS', 'EXPORTS', 'WRITES', 'READS_CONFIG', 'CALLS_EXTERNAL']) {
			assert.equal(referenceSet.has(kind), false, `expected ${kind} not to be a reference`);
		}
	});

	it('only lists declared edge kinds', () => {
		const declared = new Set<string>(EDGE_KINDS);
		for (const kind of REFERENCE_EDGE_KINDS) {
			assert.ok(declared.has(kind));
		}
	});
});

const MODULE = 'Module:src/a.ts';
const TARGET = 'Function:src/a.ts#target@1';
const READER = 'Function:src/a.ts#reader@2';
const WRITER = 'Function:src/a.ts#writer@3';
const OVERRIDER = 'Method:src/a.ts#render@4';
const WRITE_ONLY = 'Variable:src/a.ts#writeOnly@5';

function range(line: number): GraphNode['range'] {
	return { startLine: line, startColumn: 0, endLine: line, endColumn: 0 };
}

const NODES: GraphNode[] = [
	{ id: MODULE, kind: 'Module', name: 'a', filePath: 'src/a.ts' },
	{ id: TARGET, kind: 'Function', name: 'target', filePath: 'src/a.ts', range: range(1), exported: true },
	{ id: READER, kind: 'Function', name: 'reader', filePath: 'src/a.ts', range: range(2) },
	{ id: WRITER, kind: 'Function', name: 'writer', filePath: 'src/a.ts', range: range(3) },
	{ id: OVERRIDER, kind: 'Method', name: 'render', filePath: 'src/a.ts', range: range(4) },
	{ id: WRITE_ONLY, kind: 'Variable', name: 'writeOnly', filePath: 'src/a.ts', range: range(5), exported: true },
];

const EDGES: GraphEdge[] = [
	{ id: `READS:${READER}->${TARGET}`, kind: 'READS', from: READER, to: TARGET },
	{ id: `OVERRIDES:${OVERRIDER}->${TARGET}`, kind: 'OVERRIDES', from: OVERRIDER, to: TARGET },
	{ id: `WRITES:${WRITER}->${TARGET}`, kind: 'WRITES', from: WRITER, to: TARGET },
	{ id: `EXPORTS:${MODULE}->${TARGET}`, kind: 'EXPORTS', from: MODULE, to: TARGET },
	{ id: `WRITES:${WRITER}->${WRITE_ONLY}`, kind: 'WRITES', from: WRITER, to: WRITE_ONLY },
	{ id: `EXPORTS:${MODULE}->${WRITE_ONLY}`, kind: 'EXPORTS', from: MODULE, to: WRITE_ONLY },
];

describe('reference-edge set drives references and dead-exports', () => {
	let dir: string;
	let store: KuzuStore;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'tkg-ref-'));
		store = new KuzuStore(join(dir, 'graph.kuzu'));
		await store.initSchema();
		await store.load(NODES, EDGES);
	});

	afterEach(async () => {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('references counts READS and OVERRIDES but not WRITES or EXPORTS', async () => {
		const query = new GraphQuery(store);
		const refs = await query.references(TARGET);
		const kinds = new Set(refs.map((ref) => ref.edgeKind));
		assert.deepEqual(kinds, new Set(['READS', 'OVERRIDES']));
		assert.deepEqual(new Set(refs.map((ref) => ref.id)), new Set([READER, OVERRIDER]));
	});

	it('a symbol kept alive only by a WRITE is reported dead; one with a READ/OVERRIDE is not', async () => {
		const query = new GraphQuery(store);
		const dead = await query.deadExports();
		const deadIds = new Set(dead.map((ref) => ref.id));
		assert.ok(deadIds.has(WRITE_ONLY), 'write-only export should be dead');
		assert.equal(deadIds.has(TARGET), false, 'referenced export should not be dead');
	});
});
