import { Node, SourceFile, SyntaxKind } from 'ts-morph';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';
import { NodeId } from './node_id.js';
import { ScopeResolver } from './scope_resolver.js';
import { Extraction } from './structural_extractor.js';

/** Receivers on which a `.fetch(...)` call is the WHATWG global rather than a user method. */
const FETCH_GLOBALS = new Set(['window', 'globalThis', 'self']);

/** Host used when a fetch target is not a static URL (a variable, a built string, a relative path). */
const DYNAMIC_TARGET = '(dynamic)';

/**
 * Detects outbound HTTP calls via `fetch(...)` and emits an `ExternalAPI` node for
 * the called host plus a `CALLS_EXTERNAL` edge from the calling declaration. The
 * host is taken from a static URL argument (`fetch('https://api.example.com/…')`);
 * a call whose target is not statically a URL is attributed to a single generic
 * `(dynamic)` node, so the outbound-I/O call site is still surfaced. Calls to the
 * same host from one scope collapse to a single counted edge.
 *
 * Detection is purely syntactic (no symbol resolution), so it runs in the
 * structural pass; a project that never calls `fetch` is unchanged. Other HTTP
 * clients (axios, got, …) are out of scope for now — fetch first (#31 Part 2b).
 */
export class ApiExtractor {
	static extract(sourceFile: SourceFile, rootPath: string): Extraction {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];
		const moduleId = NodeId.forModule(sourceFile.getFilePath(), rootPath);

		for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
			if (ApiExtractor.isFetchCall(call.getExpression()) === false) {
				continue;
			}
			const host = ApiExtractor.targetHost(call.getArguments()[0]);
			const apiId = NodeId.forExternalApi(host);
			nodes.push({ id: apiId, kind: 'ExternalAPI', name: host, filePath: host });
			const scopeId = ScopeResolver.enclosingId(call, moduleId, rootPath);
			edges.push({ id: `CALLS_EXTERNAL:${scopeId}->${apiId}`, kind: 'CALLS_EXTERNAL', from: scopeId, to: apiId });
		}

		return { nodes, edges };
	}

	/** `fetch(...)` — the bare global, or `window` / `globalThis` / `self`.fetch(...). */
	private static isFetchCall(callee: Node): boolean {
		if (Node.isIdentifier(callee) === true) {
			return callee.getText() === 'fetch';
		}
		const access = callee.asKind(SyntaxKind.PropertyAccessExpression);
		if (access === undefined || access.getName() !== 'fetch') {
			return false;
		}
		const target = access.getExpression();
		return Node.isIdentifier(target) === true && FETCH_GLOBALS.has(target.getText()) === true;
	}

	/** The host of a static URL argument, or {@link DYNAMIC_TARGET} when not statically a URL. */
	private static targetHost(argument: Node | undefined): string {
		const url = ApiExtractor.staticUrl(argument);
		if (url === undefined) {
			return DYNAMIC_TARGET;
		}
		try {
			return new URL(url).host || DYNAMIC_TARGET;
		} catch {
			return DYNAMIC_TARGET;
		}
	}

	/** The literal text of a string / no-substitution-template argument, else undefined. */
	private static staticUrl(argument: Node | undefined): string | undefined {
		const string = argument?.asKind(SyntaxKind.StringLiteral);
		if (string !== undefined) {
			return string.getLiteralText();
		}
		return argument?.asKind(SyntaxKind.NoSubstitutionTemplateLiteral)?.getLiteralText();
	}
}
