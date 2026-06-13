import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Connection, Database, QueryResult } from 'kuzu';
import type { KuzuValue } from 'kuzu';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';

/** A stored node read back from Kùzu, with its metadata decoded to a record. */
export type StoredNode = {
	id: string;
	kind: string;
	name: string;
	filePath: string;
	startLine: number;
	endLine: number;
	metadata: Record<string, unknown>;
};

const SCHEMA = [
	'CREATE NODE TABLE IF NOT EXISTS GraphNode (id STRING, kind STRING, name STRING, filePath STRING, exported BOOLEAN, startLine INT64, endLine INT64, metadata STRING, PRIMARY KEY (id))',
	'CREATE REL TABLE IF NOT EXISTS Edge (FROM GraphNode TO GraphNode, kind STRING, metadata STRING)',
	'CREATE NODE TABLE IF NOT EXISTS GraphMeta (key STRING, value STRING, PRIMARY KEY (key))',
];

export class KuzuStore {
	private readonly db: Database;
	private readonly conn: Connection;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		this.conn = new Connection(this.db);
	}

	async initSchema(): Promise<void> {
		for (const statement of SCHEMA) {
			KuzuStore.closeResults(await this.conn.query(statement));
		}
	}

	async load(nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
		const nodeStmt = await this.conn.prepare(
			'MERGE (n:GraphNode {id: $id}) SET n.kind = $kind, n.name = $name, n.filePath = $filePath, n.exported = $exported, n.startLine = $startLine, n.endLine = $endLine, n.metadata = $metadata',
		);
		for (const node of nodes) {
			KuzuStore.closeResults(await this.conn.execute(nodeStmt, {
				id: node.id,
				kind: node.kind,
				name: node.name,
				filePath: node.filePath,
				exported: node.exported ?? false,
				startLine: node.range?.startLine ?? 0,
				endLine: node.range?.endLine ?? 0,
				metadata: KuzuStore.encodeMetadata(node.metadata),
			}));
		}
		const edgeStmt = await this.conn.prepare(
			'MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[e:Edge {kind: $kind}]->(t) SET e.metadata = $metadata',
		);
		for (const edge of edges) {
			KuzuStore.closeResults(await this.conn.execute(edgeStmt, {
				from: edge.from,
				to: edge.to,
				kind: edge.kind,
				metadata: KuzuStore.encodeMetadata(edge.metadata),
			}));
		}
	}

	/**
	 * Inserts or updates edges by (`from`, `to`, `kind`) — the same merge `load`
	 * uses for its edge pass — onto an already-loaded graph; both endpoint nodes
	 * must already exist. Used by `enrich` to attach the runtime call graph after
	 * the static graph is loaded.
	 */
	async writeEdges(edges: GraphEdge[]): Promise<void> {
		if (edges.length === 0) {
			return;
		}
		const stmt = await this.conn.prepare(
			'MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[e:Edge {kind: $kind}]->(t) SET e.metadata = $metadata',
		);
		for (const edge of edges) {
			KuzuStore.closeResults(await this.conn.execute(stmt, {
				from: edge.from,
				to: edge.to,
				kind: edge.kind,
				metadata: KuzuStore.encodeMetadata(edge.metadata),
			}));
		}
	}

	/**
	 * Removes every edge of a given kind. Used by `enrich` to clear the prior
	 * runtime call graph before writing a fresh one, so a re-run never leaves stale
	 * edges behind.
	 */
	async clearEdgesByKind(kind: string): Promise<void> {
		const stmt = await this.conn.prepare('MATCH (:GraphNode)-[e:Edge {kind: $kind}]->(:GraphNode) DELETE e');
		KuzuStore.closeResults(await this.conn.execute(stmt, { kind }));
	}

	/**
	 * Reads every node back from the store, decoding the `metadata` column. Used
	 * by enrichment to resolve profile frames against the loaded graph's ranges
	 * and to merge new metadata onto existing records.
	 */
	async readNodes(): Promise<StoredNode[]> {
		const rows = await this.run(
			'MATCH (n:GraphNode) RETURN n.id AS id, n.kind AS kind, n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.metadata AS metadata',
		);
		return rows.map((row) => ({
			id: String(row.id),
			kind: String(row.kind),
			name: String(row.name),
			filePath: String(row.filePath),
			startLine: Number(row.startLine),
			endLine: Number(row.endLine),
			metadata: KuzuStore.decodeMetadata(row.metadata),
		}));
	}

	/**
	 * Overwrites the `metadata` column for the given nodes. The caller is
	 * responsible for merging so that only the intended keys change; passing the
	 * full record keeps the write idempotent for unchanged keys.
	 */
	async writeNodeMetadata(entries: { id: string; metadata: Record<string, unknown> }[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		const stmt = await this.conn.prepare('MATCH (n:GraphNode {id: $id}) SET n.metadata = $metadata');
		for (const entry of entries) {
			KuzuStore.closeResults(await this.conn.execute(stmt, {
				id: entry.id,
				metadata: KuzuStore.encodeMetadata(entry.metadata),
			}));
		}
	}

	/**
	 * Writes a graph-level metadata record under `key` (a `GraphMeta` row), encoding
	 * the value as JSON. Used for facts about the whole graph rather than one node —
	 * e.g. the runtime ingest manifest `enrich` records for coverage reporting.
	 */
	async writeGraphMeta(key: string, value: Record<string, unknown>): Promise<void> {
		const stmt = await this.conn.prepare('MERGE (m:GraphMeta {key: $key}) SET m.value = $value');
		KuzuStore.closeResults(await this.conn.execute(stmt, { key, value: KuzuStore.encodeMetadata(value) }));
	}

	/** Reads the graph-level metadata record stored under `key`, decoded, or null when absent. */
	async readGraphMeta(key: string): Promise<Record<string, unknown> | null> {
		const rows = await this.run('MATCH (m:GraphMeta {key: $key}) RETURN m.value AS value', { key });
		if (rows.length === 0) {
			return null;
		}
		return KuzuStore.decodeMetadata(rows[0].value);
	}

	/** Removes the graph-level metadata record stored under `key`, if any. */
	async clearGraphMeta(key: string): Promise<void> {
		const stmt = await this.conn.prepare('MATCH (m:GraphMeta {key: $key}) DELETE m');
		KuzuStore.closeResults(await this.conn.execute(stmt, { key }));
	}

	/**
	 * Serializes an optional metadata record to a JSON string for storage in the
	 * `metadata` column. Absent metadata is stored as an empty object so the
	 * column is never null.
	 */
	private static encodeMetadata(metadata: Record<string, unknown> | undefined): string {
		return JSON.stringify(metadata ?? {});
	}

	/**
	 * Decodes the JSON `metadata` column back into a record. A missing, empty, or
	 * malformed value decodes to an empty object so callers always receive a record.
	 */
	private static decodeMetadata(value: KuzuValue): Record<string, unknown> {
		if (typeof value !== 'string' || value.length === 0) {
			return {};
		}
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null) {
				return parsed as Record<string, unknown>;
			}
			return {};
		} catch {
			return {};
		}
	}

	async run(cypher: string, params?: Record<string, KuzuValue>): Promise<Record<string, KuzuValue>[]> {
		const result = params === undefined
			? await this.conn.query(cypher)
			: await this.conn.execute(await this.conn.prepare(cypher), params);
		try {
			return await KuzuStore.first(result).getAll();
		} finally {
			KuzuStore.closeResults(result);
		}
	}

	async close(): Promise<void> {
		await this.conn.close();
		await this.db.close();
	}

	private static first(result: QueryResult | QueryResult[]): QueryResult {
		return Array.isArray(result) ? result[0] : result;
	}

	/**
	 * Releases the native memory behind one or more query results. Results left
	 * unclosed are finalized after the database shuts down at process exit,
	 * which crashes the kuzu native module with a segmentation fault.
	 */
	private static closeResults(result: QueryResult | QueryResult[]): void {
		for (const item of Array.isArray(result) ? result : [result]) {
			item.close();
		}
	}
}
