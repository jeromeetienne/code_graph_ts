import { Project } from 'ts-morph';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';
import { ApiExtractor } from './api_extractor.js';
import { ConfigExtractor } from './config_extractor.js';
import { SemanticExtractor } from './semantic_extractor.js';
import { Extraction, StructuralExtractor } from './structural_extractor.js';

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
			this.merge(ConfigExtractor.extract(sourceFile, rootPath));
			this.merge(ApiExtractor.extract(sourceFile, rootPath));
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
			this.addEdge(edge);
		}
	}

	/**
	 * Adds an edge, collapsing duplicates by id while counting how many times the
	 * relationship occurs in source. The first occurrence is stored with
	 * `metadata.count = 1`; each later occurrence increments that count instead of
	 * overwriting the edge. Any pre-existing metadata (such as the `specifier` on
	 * an `IMPORTS` edge) is preserved.
	 */
	private addEdge(edge: GraphEdge): void {
		const existing = this.edges.get(edge.id);
		if (existing === undefined) {
			this.edges.set(edge.id, { ...edge, metadata: { ...edge.metadata, count: 1 } });
			return;
		}
		const current = typeof existing.metadata?.count === 'number' ? existing.metadata.count : 1;
		existing.metadata = { ...existing.metadata, count: current + 1 };
	}

	private static isProjectFile(filePath: string): boolean {
		return filePath.includes('/node_modules/') === false && filePath.endsWith('.d.ts') === false;
	}
}
