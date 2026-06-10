import { SemanticExtractor } from './semantic-extractor';
import { StructuralExtractor } from './structural-extractor';
export class GraphBuilder {
    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
    }
    build(project, rootPath, options) {
        const sourceFiles = project
            .getSourceFiles()
            .filter((file) => GraphBuilder.isProjectFile(file.getFilePath()));
        for (const sourceFile of sourceFiles) {
            this.merge(StructuralExtractor.extract(sourceFile, rootPath));
        }
        if (options.semantic === true) {
            for (const sourceFile of sourceFiles) {
                this.merge(SemanticExtractor.extract(sourceFile, rootPath));
            }
        }
    }
    getNodes() {
        return [...this.nodes.values()];
    }
    getEdges() {
        return [...this.edges.values()];
    }
    merge(extraction) {
        for (const node of extraction.nodes) {
            this.nodes.set(node.id, node);
        }
        for (const edge of extraction.edges) {
            this.edges.set(edge.id, edge);
        }
    }
    static isProjectFile(filePath) {
        return filePath.includes('/node_modules/') === false && filePath.endsWith('.d.ts') === false;
    }
}
//# sourceMappingURL=graph-builder.js.map