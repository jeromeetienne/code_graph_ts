import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Connection, Database } from 'kuzu';
const SCHEMA = [
    'CREATE NODE TABLE IF NOT EXISTS GraphNode (id STRING, kind STRING, name STRING, filePath STRING, exported BOOLEAN, startLine INT64, endLine INT64, PRIMARY KEY (id))',
    'CREATE REL TABLE IF NOT EXISTS Edge (FROM GraphNode TO GraphNode, kind STRING)',
];
export class KuzuStore {
    constructor(dbPath) {
        mkdirSync(dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.conn = new Connection(this.db);
    }
    async initSchema() {
        for (const statement of SCHEMA) {
            await this.conn.query(statement);
        }
    }
    async load(nodes, edges) {
        const nodeStmt = await this.conn.prepare('MERGE (n:GraphNode {id: $id}) SET n.kind = $kind, n.name = $name, n.filePath = $filePath, n.exported = $exported, n.startLine = $startLine, n.endLine = $endLine');
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
        const edgeStmt = await this.conn.prepare('MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[:Edge {kind: $kind}]->(t)');
        for (const edge of edges) {
            await this.conn.execute(edgeStmt, { from: edge.from, to: edge.to, kind: edge.kind });
        }
    }
    async run(cypher, params) {
        if (params === undefined) {
            return KuzuStore.first(await this.conn.query(cypher)).getAll();
        }
        const stmt = await this.conn.prepare(cypher);
        return KuzuStore.first(await this.conn.execute(stmt, params)).getAll();
    }
    async close() {
        await this.conn.close();
        await this.db.close();
    }
    static first(result) {
        return Array.isArray(result) ? result[0] : result;
    }
}
//# sourceMappingURL=kuzu-store.js.map