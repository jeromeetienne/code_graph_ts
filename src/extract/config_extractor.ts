import { Node, SourceFile, SyntaxKind } from 'ts-morph';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';
import { NodeId } from './node_id.js';
import { ScopeResolver } from './scope_resolver.js';
import { Extraction } from './structural_extractor.js';

/**
 * Detects configuration reads — `process.env.NAME` and `process.env['NAME']` —
 * and emits one `ConfigFlag` node per distinct variable plus a `READS_CONFIG`
 * edge from the enclosing declaration that performs the read. A variable read in
 * several places collapses to one node (keyed by name) with one counted edge per
 * reading scope.
 *
 * The detection is purely syntactic (no symbol resolution), so it runs in the
 * structural pass and is always emitted. A project that never touches
 * `process.env` produces no config nodes or edges, leaving its graph unchanged.
 */
export class ConfigExtractor {
	static extract(sourceFile: SourceFile, rootPath: string): Extraction {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];
		const moduleId = NodeId.forModule(sourceFile.getFilePath(), rootPath);

		for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
			if (ConfigExtractor.isProcessEnv(access.getExpression()) === true) {
				ConfigExtractor.emit(access, access.getName(), moduleId, rootPath, nodes, edges);
			}
		}
		for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
			if (ConfigExtractor.isProcessEnv(access.getExpression()) === false) {
				continue;
			}
			const name = ConfigExtractor.stringArgument(access);
			if (name !== undefined) {
				ConfigExtractor.emit(access, name, moduleId, rootPath, nodes, edges);
			}
		}

		return { nodes, edges };
	}

	private static emit(
		access: Node,
		name: string,
		moduleId: string,
		rootPath: string,
		nodes: GraphNode[],
		edges: GraphEdge[],
	): void {
		if (name === '') {
			return;
		}
		const flagId = NodeId.forConfigFlag(name);
		nodes.push({ id: flagId, kind: 'ConfigFlag', name, filePath: 'process.env' });
		const scopeId = ScopeResolver.enclosingId(access, moduleId, rootPath);
		edges.push({ id: `READS_CONFIG:${scopeId}->${flagId}`, kind: 'READS_CONFIG', from: scopeId, to: flagId });
	}

	/** Whether a node is the `process.env` member access (`process` identifier, `env` name). */
	private static isProcessEnv(node: Node): boolean {
		const access = node.asKind(SyntaxKind.PropertyAccessExpression);
		if (access === undefined || access.getName() !== 'env') {
			return false;
		}
		const target = access.getExpression();
		return Node.isIdentifier(target) === true && target.getText() === 'process';
	}

	/** The literal key of `process.env['NAME']`, or undefined when the key is computed. */
	private static stringArgument(access: Node): string | undefined {
		const element = access.asKind(SyntaxKind.ElementAccessExpression);
		const literal = element?.getArgumentExpression()?.asKind(SyntaxKind.StringLiteral);
		return literal?.getLiteralText();
	}
}
