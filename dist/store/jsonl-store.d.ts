import { GraphEdge } from '../schema/edge';
import { GraphNode } from '../schema/node';
export declare class JsonlStore {
    static write(outDir: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
    private static serialize;
}
//# sourceMappingURL=jsonl-store.d.ts.map