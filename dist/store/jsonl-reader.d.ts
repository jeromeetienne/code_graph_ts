import { GraphEdge } from '../schema/edge';
import { GraphNode } from '../schema/node';
export type GraphData = {
    nodes: GraphNode[];
    edges: GraphEdge[];
};
export declare class JsonlReader {
    static read(dir: string): Promise<GraphData>;
    private static readLines;
}
//# sourceMappingURL=jsonl-reader.d.ts.map