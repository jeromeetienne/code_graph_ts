import { KuzuStore } from '../store/kuzu-store';
export type SymbolRef = {
    id: string;
    kind: string;
    name: string;
    filePath: string;
    startLine: number;
};
export type NeighborRef = SymbolRef & {
    edgeKind: string;
    direction: 'in' | 'out';
};
export declare class GraphQuery {
    private readonly store;
    constructor(store: KuzuStore);
    whoCalls(id: string): Promise<SymbolRef[]>;
    calls(id: string): Promise<SymbolRef[]>;
    blastRadius(id: string, depth: number): Promise<SymbolRef[]>;
    deadExports(): Promise<SymbolRef[]>;
    references(id: string): Promise<NeighborRef[]>;
    neighborhood(id: string): Promise<NeighborRef[]>;
    find(pattern: string): Promise<SymbolRef[]>;
    private static toRefs;
    private static toRef;
    private static toNeighbor;
    private static clampDepth;
}
//# sourceMappingURL=graph-query.d.ts.map