import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GraphEdgeSchema } from '../schema/edge';
import { GraphNodeSchema } from '../schema/node';
export class JsonlReader {
    static async read(dir) {
        const nodes = await JsonlReader.readLines(join(dir, 'nodes.jsonl'), GraphNodeSchema);
        const edges = await JsonlReader.readLines(join(dir, 'edges.jsonl'), GraphEdgeSchema);
        return { nodes, edges };
    }
    static async readLines(path, schema) {
        const content = await readFile(path, 'utf8');
        return content
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => schema.parse(JSON.parse(line)));
    }
}
//# sourceMappingURL=jsonl-reader.js.map