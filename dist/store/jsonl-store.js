import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export class JsonlStore {
    static async write(outDir, nodes, edges) {
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'nodes.jsonl'), JsonlStore.serialize(nodes), 'utf8');
        await writeFile(join(outDir, 'edges.jsonl'), JsonlStore.serialize(edges), 'utf8');
    }
    static serialize(rows) {
        return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    }
}
//# sourceMappingURL=jsonl-store.js.map