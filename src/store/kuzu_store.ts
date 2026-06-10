import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Connection, Database, QueryResult } from 'kuzu';
import type { KuzuValue } from 'kuzu';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';

const SCHEMA = [
	'CREATE NODE TABLE IF NOT EXISTS GraphNode (id STRING, kind STRING, name STRING, filePath STRING, exported BOOLEAN, startLine INT64, endLine INT64, PRIMARY KEY (id))',
	'CREATE REL TABLE IF NOT EXISTS Edge (FROM GraphNode TO GraphNode, kind STRING)',
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
			'MERGE (n:GraphNode {id: $id}) SET n.kind = $kind, n.name = $name, n.filePath = $filePath, n.exported = $exported, n.startLine = $startLine, n.endLine = $endLine',
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
			}));
		}
		const edgeStmt = await this.conn.prepare(
			'MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[:Edge {kind: $kind}]->(t)',
		);
		for (const edge of edges) {
			KuzuStore.closeResults(await this.conn.execute(edgeStmt, { from: edge.from, to: edge.to, kind: edge.kind }));
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
