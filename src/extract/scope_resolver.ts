import { Node, SyntaxKind } from 'ts-morph';
import { NodeId } from './node_id.js';

/**
 * Top-level declaration kinds the structural extractor emits as nodes. Used to
 * attribute a free-standing expression to an *emitted* scope: a node nested inside
 * a function (a local, a nested function) is not a graph node, so the walk skips
 * past it to the nearest enclosing emitted declaration.
 */
const TOP_LEVEL_SCOPE_KINDS = new Set<SyntaxKind>([
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.VariableDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.EnumDeclaration,
	SyntaxKind.TypeAliasDeclaration,
]);

/**
 * Resolves the graph node a free-standing expression (a `process.env` read, a
 * `fetch` call) should be attributed to: the id of the nearest enclosing
 * declaration the structural extractor actually emits, falling back to the module.
 *
 * Because a node nested inside a function (a local, a nested function, an arrow) is
 * not itself a graph node, the walk skips past it to the enclosing top-level
 * function/variable/class or class member — so the returned id always exists in the
 * graph and the edge built from it is never dropped at load.
 */
export class ScopeResolver {
	static enclosingId(node: Node, moduleId: string, rootPath: string): string {
		const scope = node.getFirstAncestor((ancestor) => ScopeResolver.isEmittedScope(ancestor));
		return scope === undefined ? moduleId : NodeId.forDeclaration(scope, rootPath);
	}

	private static isEmittedScope(node: Node): boolean {
		const kind = node.getKind();
		if (kind === SyntaxKind.MethodDeclaration || kind === SyntaxKind.PropertyDeclaration) {
			return true;
		}
		if (TOP_LEVEL_SCOPE_KINDS.has(kind) === false) {
			return false;
		}
		if (kind === SyntaxKind.VariableDeclaration) {
			const statement = node.asKind(SyntaxKind.VariableDeclaration)?.getVariableStatement();
			return statement?.getParent()?.getKind() === SyntaxKind.SourceFile;
		}
		return node.getParent()?.getKind() === SyntaxKind.SourceFile;
	}
}
