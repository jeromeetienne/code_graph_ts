import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Project } from 'ts-morph';
import { GraphBuilder } from '../src/extract/graph_builder.js';
import { GraphQuery } from '../src/query/graph_query.js';
import { GraphEdge } from '../src/schema/edge.js';
import { GraphNode } from '../src/schema/node.js';
import { KuzuStore } from '../src/store/kuzu_store.js';

function build(source: string, semantic = false): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const project = new Project({ useInMemoryFileSystem: true });
	project.createSourceFile('src/a.ts', source);
	const builder = new GraphBuilder();
	builder.build(project, '/', { semantic });
	return { nodes: builder.getNodes(), edges: builder.getEdges() };
}

const apis = (nodes: GraphNode[]): GraphNode[] => nodes.filter((node) => node.kind === 'ExternalAPI');
const callsExternal = (edges: GraphEdge[]): GraphEdge[] => edges.filter((edge) => edge.kind === 'CALLS_EXTERNAL');

describe('ExternalAPI / fetch extraction', () => {
	it('emits an ExternalAPI host node and a CALLS_EXTERNAL edge for a static fetch', () => {
		const { nodes, edges } = build("export function f() { return fetch('https://api.example.com/users'); }");
		const found = apis(nodes);
		assert.equal(found.length, 1);
		assert.equal(found[0].id, 'Api:api.example.com');
		assert.equal(found[0].name, 'api.example.com');
		const calls = callsExternal(edges);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].to, 'Api:api.example.com');
		assert.ok(calls[0].from.includes('#f@'));
	});

	it('collapses calls to one host into a single node, counted per scope', () => {
		const { nodes, edges } = build(`
export function f() {
	fetch('https://api.example.com/a');
	fetch('https://api.example.com/b?x=1');
}
`);
		assert.equal(apis(nodes).length, 1);
		const calls = callsExternal(edges);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].metadata?.count, 2);
	});

	it('extracts the host from a no-substitution template literal', () => {
		const { nodes } = build('export function f() { return fetch(`https://api.example.com/users`); }');
		assert.equal(apis(nodes)[0]?.id, 'Api:api.example.com');
	});

	it('lumps dynamic targets (template substitution, or a variable) into one (dynamic) node', () => {
		const { nodes, edges } = build(`
export function f(base: string, url: string) {
	fetch(\`\${base}/users\`);
	fetch(url);
}
`);
		const found = apis(nodes);
		assert.equal(found.length, 1);
		assert.equal(found[0].id, 'Api:(dynamic)');
		const calls = callsExternal(edges);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].metadata?.count, 2);
	});

	it('treats a relative URL as dynamic (no external host)', () => {
		const { nodes } = build("export function f() { return fetch('/api/users'); }");
		assert.equal(apis(nodes)[0]?.id, 'Api:(dynamic)');
	});

	it('detects window.fetch and globalThis.fetch', () => {
		const win = build("export function f() { return window.fetch('https://a.example.com/x'); }");
		assert.equal(apis(win.nodes)[0]?.id, 'Api:a.example.com');
		const glob = build("export function f() { return globalThis.fetch('https://b.example.com/x'); }");
		assert.equal(apis(glob.nodes)[0]?.id, 'Api:b.example.com');
	});

	it('does not match a user method named fetch', () => {
		const { nodes } = build('export class Repo { fetch(): void {} load(): void { this.fetch(); } }');
		assert.equal(apis(nodes).length, 0);
		const obj = build('export function f(repo: { fetch(): void }) { repo.fetch(); }');
		assert.equal(apis(obj.nodes).length, 0);
	});

	it('attributes a method call to the method and a nested-function call to the nearest emitted scope', () => {
		const method = build("export class S { run() { return fetch('https://api.example.com/x'); } }");
		assert.ok(callsExternal(method.edges)[0]?.from.includes('#run@'));

		const nested = build(`
export function outer() {
	function inner() { return fetch('https://api.example.com/x'); }
	return inner;
}
`);
		const edge = callsExternal(nested.edges)[0];
		assert.ok(edge !== undefined && edge.from.includes('#outer@'));
		assert.ok(edge !== undefined && nested.nodes.some((node) => node.id === edge.from));
	});

	it('is emitted by the structural layer alone, and leaves a fetch-free project unchanged', () => {
		const { nodes } = build("export const p = fetch('https://api.example.com/x');", false);
		assert.equal(apis(nodes).length, 1);
		const none = build('export function f(): number { return 1; }');
		assert.equal(apis(none.nodes).length, 0);
		assert.equal(callsExternal(none.edges).length, 0);
	});
});

describe('ExternalAPI is queryable via find and neighbors', () => {
	let dir: string;
	let store: KuzuStore;

	beforeEach(async () => {
		const { nodes, edges } = build("export function callApi() { return fetch('https://api.example.com/data'); }");
		dir = await mkdtemp(join(tmpdir(), 'tkg-api-'));
		store = new KuzuStore(join(dir, 'graph.kuzu'));
		await store.initSchema();
		await store.load(nodes, edges);
	});

	afterEach(async () => {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('find locates the ExternalAPI by host', async () => {
		const refs = await new GraphQuery(store).find('example.com');
		const api = refs.find((ref) => ref.kind === 'ExternalAPI');
		assert.notEqual(api, undefined);
		assert.equal(api?.id, 'Api:api.example.com');
	});

	it('neighbors of the ExternalAPI lists the caller via CALLS_EXTERNAL', async () => {
		const neighbors = await new GraphQuery(store).neighborhood('Api:api.example.com');
		assert.equal(neighbors.length, 1);
		assert.equal(neighbors[0].edgeKind, 'CALLS_EXTERNAL');
		assert.equal(neighbors[0].direction, 'in');
		assert.equal(neighbors[0].name, 'callApi');
	});
});
