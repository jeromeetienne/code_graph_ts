import { Project } from 'ts-morph';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';
import { SemanticExtractor } from './semantic-extractor.js';
import { Extraction, StructuralExtractor } from './structural-extractor.js';

export type BuildOptions = {
	semantic: boolean;
};

export class GraphBuilder {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly edges = new Map<string, GraphEdge>();

	build(project: Project, rootPath: string, options: BuildOptions): void {
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

	getNodes(): GraphNode[] {
		return [...this.nodes.values()];
	}

	getEdges(): GraphEdge[] {
		return [...this.edges.values()];
	}

	private merge(extraction: Extraction): void {
		for (const node of extraction.nodes) {
			this.nodes.set(node.id, node);
		}
		for (const edge of extraction.edges) {
			this.edges.set(edge.id, edge);
		}
	}

	private static isProjectFile(filePath: string): boolean {
		return filePath.includes('/node_modules/') === false && filePath.endsWith('.d.ts') === false;
	}
}
