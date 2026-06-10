import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';

export class JsonlStore {
	static async write(outDir: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
		await mkdir(outDir, { recursive: true });
		await writeFile(join(outDir, 'nodes.jsonl'), JsonlStore.serialize(nodes), 'utf8');
		await writeFile(join(outDir, 'edges.jsonl'), JsonlStore.serialize(edges), 'utf8');
	}

	private static serialize(rows: unknown[]): string {
		return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
	}
}
