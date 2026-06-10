import { relative } from 'node:path';
import {
	ClassDeclaration,
	InterfaceDeclaration,
	Node,
	SourceFile,
} from 'ts-morph';
import { GraphEdge } from '../schema/edge';
import { GraphNode, NodeKind } from '../schema/node';
import { NodeId } from './node-id';

export type Extraction = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};

export class StructuralExtractor {
	static extract(sourceFile: SourceFile, rootPath: string): Extraction {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];
		const filePath = relative(rootPath, sourceFile.getFilePath());
		const moduleId = NodeId.forModule(sourceFile.getFilePath(), rootPath);

		nodes.push({ id: moduleId, kind: 'Module', name: filePath, filePath });

		StructuralExtractor.extractImports(sourceFile, moduleId, rootPath, nodes, edges);

		for (const cls of sourceFile.getClasses()) {
			StructuralExtractor.extractClass(cls, moduleId, rootPath, nodes, edges);
		}
		for (const iface of sourceFile.getInterfaces()) {
			StructuralExtractor.extractInterface(iface, moduleId, rootPath, nodes, edges);
		}
		for (const alias of sourceFile.getTypeAliases()) {
			StructuralExtractor.push(alias, 'TypeAlias', moduleId, rootPath, nodes, edges);
		}
		for (const en of sourceFile.getEnums()) {
			StructuralExtractor.push(en, 'Enum', moduleId, rootPath, nodes, edges);
		}
		for (const fn of sourceFile.getFunctions()) {
			StructuralExtractor.push(fn, 'Function', moduleId, rootPath, nodes, edges);
		}
		for (const variable of sourceFile.getVariableDeclarations()) {
			StructuralExtractor.push(variable, 'Variable', moduleId, rootPath, nodes, edges);
		}

		return { nodes, edges };
	}

	private static extractImports(
		sourceFile: SourceFile,
		moduleId: string,
		rootPath: string,
		nodes: GraphNode[],
		edges: GraphEdge[],
	): void {
		for (const decl of sourceFile.getImportDeclarations()) {
			const specifier = decl.getModuleSpecifierValue();
			const target = decl.getModuleSpecifierSourceFile();
			if (target !== undefined && StructuralExtractor.isInternal(target) === true) {
				const targetId = NodeId.forModule(target.getFilePath(), rootPath);
				edges.push(StructuralExtractor.edge('IMPORTS', moduleId, targetId, { specifier }));
				continue;
			}
			const externalId = NodeId.forExternalModule(specifier);
			nodes.push({ id: externalId, kind: 'ExternalModule', name: specifier, filePath: specifier });
			edges.push(StructuralExtractor.edge('IMPORTS', moduleId, externalId, { specifier }));
		}
	}

	private static extractClass(
		cls: ClassDeclaration,
		moduleId: string,
		rootPath: string,
		nodes: GraphNode[],
		edges: GraphEdge[],
	): void {
		const classId = StructuralExtractor.push(cls, 'Class', moduleId, rootPath, nodes, edges);
		for (const method of cls.getMethods()) {
			StructuralExtractor.push(method, 'Method', classId, rootPath, nodes, edges);
		}
		for (const property of cls.getProperties()) {
			StructuralExtractor.push(property, 'Property', classId, rootPath, nodes, edges);
		}
	}

	private static extractInterface(
		iface: InterfaceDeclaration,
		moduleId: string,
		rootPath: string,
		nodes: GraphNode[],
		edges: GraphEdge[],
	): void {
		const ifaceId = StructuralExtractor.push(iface, 'Interface', moduleId, rootPath, nodes, edges);
		for (const method of iface.getMethods()) {
			StructuralExtractor.push(method, 'Method', ifaceId, rootPath, nodes, edges);
		}
		for (const property of iface.getProperties()) {
			StructuralExtractor.push(property, 'Property', ifaceId, rootPath, nodes, edges);
		}
	}

	private static push(
		node: Node,
		kind: NodeKind,
		parentId: string,
		rootPath: string,
		nodes: GraphNode[],
		edges: GraphEdge[],
	): string {
		const id = NodeId.forDeclaration(node, rootPath);
		nodes.push({
			id,
			kind,
			name: NodeId.nameOf(node),
			filePath: relative(rootPath, node.getSourceFile().getFilePath()),
			range: {
				startLine: node.getStartLineNumber(),
				startColumn: 0,
				endLine: node.getEndLineNumber(),
				endColumn: 0,
			},
			exported: StructuralExtractor.isExported(node),
		});
		edges.push(StructuralExtractor.edge('CONTAINS', parentId, id));
		return id;
	}

	private static isInternal(sourceFile: SourceFile): boolean {
		return sourceFile.getFilePath().includes('/node_modules/') === false
			&& sourceFile.isDeclarationFile() === false;
	}

	private static isExported(node: Node): boolean {
		const probe = node as { isExported?: () => boolean };
		return typeof probe.isExported === 'function' ? probe.isExported() : false;
	}

	private static edge(
		kind: GraphEdge['kind'],
		from: string,
		to: string,
		metadata?: Record<string, unknown>,
	): GraphEdge {
		const edge: GraphEdge = { id: `${kind}:${from}->${to}`, kind, from, to };
		if (metadata !== undefined) {
			edge.metadata = metadata;
		}
		return edge;
	}
}
