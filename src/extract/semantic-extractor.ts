import {
	ClassDeclaration,
	InterfaceDeclaration,
	Node,
	SourceFile,
	SyntaxKind,
} from 'ts-morph';
import { GraphEdge } from '../schema/edge';
import { NodeId } from './node-id';
import { Extraction } from './structural-extractor';

const CALLABLE_TARGET_KINDS = new Set<SyntaxKind>([
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.MethodDeclaration,
	SyntaxKind.MethodSignature,
	SyntaxKind.VariableDeclaration,
]);

export class SemanticExtractor {
	static extract(sourceFile: SourceFile, rootPath: string): Extraction {
		const edges: GraphEdge[] = [];
		for (const cls of sourceFile.getClasses()) {
			SemanticExtractor.extractClassHeritage(cls, rootPath, edges);
		}
		for (const iface of sourceFile.getInterfaces()) {
			SemanticExtractor.extractInterfaceHeritage(iface, rootPath, edges);
		}
		SemanticExtractor.extractCalls(sourceFile, rootPath, edges);
		return { nodes: [], edges };
	}

	private static extractClassHeritage(cls: ClassDeclaration, rootPath: string, edges: GraphEdge[]): void {
		const classId = NodeId.forDeclaration(cls, rootPath);
		const base = cls.getBaseClass();
		if (base !== undefined && SemanticExtractor.inProject(base) === true) {
			edges.push(SemanticExtractor.edge('EXTENDS', classId, NodeId.forDeclaration(base, rootPath)));
		}
		for (const impl of cls.getImplements()) {
			const decl = SemanticExtractor.resolve(impl.getExpression());
			if (decl !== undefined && SemanticExtractor.inProject(decl) === true) {
				edges.push(SemanticExtractor.edge('IMPLEMENTS', classId, NodeId.forDeclaration(decl, rootPath)));
			}
		}
	}

	private static extractInterfaceHeritage(iface: InterfaceDeclaration, rootPath: string, edges: GraphEdge[]): void {
		const ifaceId = NodeId.forDeclaration(iface, rootPath);
		for (const base of iface.getBaseDeclarations()) {
			if (SemanticExtractor.inProject(base) === true) {
				edges.push(SemanticExtractor.edge('EXTENDS', ifaceId, NodeId.forDeclaration(base, rootPath)));
			}
		}
	}

	private static extractCalls(sourceFile: SourceFile, rootPath: string, edges: GraphEdge[]): void {
		for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
			const caller = SemanticExtractor.enclosingDeclaration(call);
			if (caller === undefined) {
				continue;
			}
			const callee = SemanticExtractor.resolve(call.getExpression());
			if (callee === undefined || SemanticExtractor.inProject(callee) === false) {
				continue;
			}
			if (CALLABLE_TARGET_KINDS.has(callee.getKind()) === false) {
				continue;
			}
			edges.push(SemanticExtractor.edge(
				'CALLS',
				NodeId.forDeclaration(caller, rootPath),
				NodeId.forDeclaration(callee, rootPath),
			));
		}
	}

	private static enclosingDeclaration(node: Node): Node | undefined {
		return node.getFirstAncestor((ancestor) => {
			const kind = ancestor.getKind();
			return kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration;
		});
	}

	private static resolve(node: Node): Node | undefined {
		const symbol = node.getSymbol();
		if (symbol === undefined) {
			return undefined;
		}
		const declarations = symbol.getDeclarations();
		return declarations.length === 0 ? undefined : declarations[0];
	}

	private static inProject(node: Node): boolean {
		const sourceFile = node.getSourceFile();
		return sourceFile.getFilePath().includes('/node_modules/') === false
			&& sourceFile.isDeclarationFile() === false;
	}

	private static edge(kind: GraphEdge['kind'], from: string, to: string): GraphEdge {
		return { id: `${kind}:${from}->${to}`, kind, from, to };
	}
}
