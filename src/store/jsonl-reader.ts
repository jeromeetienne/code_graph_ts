import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { GraphEdge, GraphEdgeSchema } from '../schema/edge';
import { GraphNode, GraphNodeSchema } from '../schema/node';

export type GraphData = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};

export class JsonlReader {
	static async read(dir: string): Promise<GraphData> {
		const nodes = await JsonlReader.readLines(join(dir, 'nodes.jsonl'), GraphNodeSchema);
		const edges = await JsonlReader.readLines(join(dir, 'edges.jsonl'), GraphEdgeSchema);
		return { nodes, edges };
	}

	private static async readLines<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
		const content = await readFile(path, 'utf8');
		return content
			.split('\n')
			.filter((line) => line.trim().length > 0)
			.map((line) => schema.parse(JSON.parse(line)));
	}
}
