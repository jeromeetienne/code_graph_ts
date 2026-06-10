import { Project } from 'ts-morph';
import { GraphEdge } from '../schema/edge';
import { GraphNode } from '../schema/node';
export type BuildOptions = {
    semantic: boolean;
};
export declare class GraphBuilder {
    private readonly nodes;
    private readonly edges;
    build(project: Project, rootPath: string, options: BuildOptions): void;
    getNodes(): GraphNode[];
    getEdges(): GraphEdge[];
    private merge;
    private static isProjectFile;
}
//# sourceMappingURL=graph-builder.d.ts.map