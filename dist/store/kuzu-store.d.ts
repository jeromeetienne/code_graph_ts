import type { KuzuValue } from 'kuzu';
import { GraphEdge } from '../schema/edge';
import { GraphNode } from '../schema/node';
export declare class KuzuStore {
    private readonly db;
    private readonly conn;
    constructor(dbPath: string);
    initSchema(): Promise<void>;
    load(nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
    run(cypher: string, params?: Record<string, KuzuValue>): Promise<Record<string, KuzuValue>[]>;
    close(): Promise<void>;
    private static first;
}
//# sourceMappingURL=kuzu-store.d.ts.map