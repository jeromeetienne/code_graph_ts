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
			await this.conn.query(statement);
		}
	}

	async load(nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
		const nodeStmt = await this.conn.prepare(
			'MERGE (n:GraphNode {id: $id}) SET n.kind = $kind, n.name = $name, n.filePath = $filePath, n.exported = $exported, n.startLine = $startLine, n.endLine = $endLine',
		);
		for (const node of nodes) {
			await this.conn.execute(nodeStmt, {
				id: node.id,
				kind: node.kind,
				name: node.name,
				filePath: node.filePath,
				exported: node.exported ?? false,
				startLine: node.range?.startLine ?? 0,
				endLine: node.range?.endLine ?? 0,
			});
		}
		const edgeStmt = await this.conn.prepare(
			'MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[:Edge {kind: $kind}]->(t)',
		);
		for (const edge of edges) {
			await this.conn.execute(edgeStmt, { from: edge.from, to: edge.to, kind: edge.kind });
		}
	}

	async run(cypher: string, params?: Record<string, KuzuValue>): Promise<Record<string, KuzuValue>[]> {
		if (params === undefined) {
			return KuzuStore.first(await this.conn.query(cypher)).getAll();
		}
		const stmt = await this.conn.prepare(cypher);
		return KuzuStore.first(await this.conn.execute(stmt, params)).getAll();
	}

	async close(): Promise<void> {
		await this.conn.close();
		await this.db.close();
	}

	private static first(result: QueryResult | QueryResult[]): QueryResult {
		return Array.isArray(result) ? result[0] : result;
	}
}
