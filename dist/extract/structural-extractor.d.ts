import { SourceFile } from 'ts-morph';
import { GraphEdge } from '../schema/edge';
import { GraphNode } from '../schema/node';
export type Extraction = {
    nodes: GraphNode[];
    edges: GraphEdge[];
};
export declare class StructuralExtractor {
    static extract(sourceFile: SourceFile, rootPath: string): Extraction;
    private static extractImports;
    private static extractClass;
    private static extractInterface;
    private static push;
    private static isInternal;
    private static isExported;
    private static edge;
}
//# sourceMappingURL=structural-extractor.d.ts.map