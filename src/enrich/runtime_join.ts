import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrameRef, FrameSample, RuntimeCallEdge } from './cpu_profile.js';

/** A graph node reduced to the fields the join needs. */
export type RuntimeTargetNode = {
	id: string;
	kind: string;
	name: string;
	filePath: string;
	startLine: number;
	endLine: number;
};

/** Self time and sample count attributed to one graph node. */
export type RuntimeAttribution = {
	samples: number;
	selfMicros: number;
};

/** How a frame was attached to its node — by symbol name or by line range. */
export type MatchVia = 'name' | 'range';

/**
 * A group of profile frames that could not be attached to a single graph node,
 * aggregated by a human-readable label so coverage gaps are reportable rather
 * than silently lost. `ambiguous` means the frame's name matched several nodes
 * in the file and the (transpiled) line could not break the tie.
 */
export type DroppedFrameGroup = {
	label: string;
	reason: 'no-file' | 'no-node' | 'ambiguous';
	samples: number;
	selfMicros: number;
};

export type RuntimeJoinResult = {
	attributions: Map<string, RuntimeAttribution>;
	matchedFrames: number;
	matchedSamples: number;
	matchedSelfMicros: number;
	matchedByName: number;
	matchedByRange: number;
	droppedFrames: number;
	droppedSamples: number;
	droppedSelfMicros: number;
	dropped: DroppedFrameGroup[];
};

export type RuntimeJoinOptions = {
	/** Project root the profile's absolute frame urls are resolved against. */
	root: string;
};

/** A runtime call edge resolved onto graph node ids, weighted by the samples that flowed through it. */
export type RuntimeEdge = {
	from: string;
	to: string;
	samples: number;
};

/** The outcome of joining the profile's call-tree edges onto graph nodes. */
export type RuntimeCallJoinResult = {
	edges: RuntimeEdge[];
	matchedEdges: number;
	droppedEdges: number;
	droppedSamples: number;
};

/**
 * Node kinds a CPU frame can plausibly name. Restricting name matching to these
 * avoids attaching an executing frame to a same-named type or enum member.
 */
const NAME_MATCH_KINDS = new Set(['Function', 'Method', 'Property', 'Variable', 'Class']);

type NodeResolution =
	| { node: RuntimeTargetNode; via: MatchVia }
	| { node: undefined; reason: 'no-node' | 'ambiguous' };

export class RuntimeJoin {
	/**
	 * Joins profile frames onto graph nodes with a hybrid key that survives
	 * transpilation.
	 *
	 * For each frame the url is resolved to a graph `filePath`, then within that
	 * file:
	 * 1. **By name** — a frame's `functionName` matched against node names. A
	 *    unique match wins outright; this is the path that works when a
	 *    transpiler (tsx/esbuild) has collapsed line numbers, since the function
	 *    name is still intact.
	 * 2. **By range** — when the name is absent or matches nothing, the innermost
	 *    node whose `[startLine, endLine]` encloses the frame line. This is the
	 *    precise path for line-preserving runs and also disambiguates a name that
	 *    matched several nodes.
	 *
	 * Frames resolving to no in-project file, to a file with no matching node, or
	 * to an unbreakable name tie are counted and reported as dropped — never
	 * attached.
	 */
	static join(
		nodes: RuntimeTargetNode[],
		frames: FrameSample[],
		options: RuntimeJoinOptions,
	): RuntimeJoinResult {
		const byFile = RuntimeJoin.indexByFile(nodes);
		const filePaths = [...byFile.keys()];

		const attributions = new Map<string, RuntimeAttribution>();
		const dropped = new Map<string, DroppedFrameGroup>();
		let matchedFrames = 0;
		let matchedSamples = 0;
		let matchedSelfMicros = 0;
		let matchedByName = 0;
		let matchedByRange = 0;
		let droppedFrames = 0;
		let droppedSamples = 0;
		let droppedSelfMicros = 0;

		for (const frame of frames) {
			const filePath = RuntimeJoin.resolveFilePath(frame.url, options.root, byFile, filePaths);
			if (filePath === undefined) {
				RuntimeJoin.recordDrop(dropped, frame, 'no-file');
				droppedFrames += 1;
				droppedSamples += frame.samples;
				droppedSelfMicros += frame.selfMicros;
				continue;
			}
			const resolution = RuntimeJoin.resolveNode(byFile.get(filePath) ?? [], frame);
			if (resolution.node === undefined) {
				RuntimeJoin.recordDrop(dropped, frame, resolution.reason);
				droppedFrames += 1;
				droppedSamples += frame.samples;
				droppedSelfMicros += frame.selfMicros;
				continue;
			}
			const current = attributions.get(resolution.node.id) ?? { samples: 0, selfMicros: 0 };
			current.samples += frame.samples;
			current.selfMicros += frame.selfMicros;
			attributions.set(resolution.node.id, current);
			matchedFrames += 1;
			matchedSamples += frame.samples;
			matchedSelfMicros += frame.selfMicros;
			if (resolution.via === 'name') {
				matchedByName += 1;
			} else {
				matchedByRange += 1;
			}
		}

		return {
			attributions,
			matchedFrames,
			matchedSamples,
			matchedSelfMicros,
			matchedByName,
			matchedByRange,
			droppedFrames,
			droppedSamples,
			droppedSelfMicros,
			dropped: [...dropped.values()].sort((a, b) => b.selfMicros - a.selfMicros),
		};
	}

	/**
	 * Joins the profile's call-tree edges onto graph node ids, reusing the same
	 * per-frame resolution as {@link join} (name match, then enclosing range) for
	 * both endpoints. Edges whose caller or callee resolves to nothing, and
	 * self-edges (recursion landing on one node), are dropped and counted; the
	 * survivors are aggregated by node pair, summing the samples that flowed through
	 * each call.
	 */
	static joinCallEdges(
		nodes: RuntimeTargetNode[],
		callEdges: RuntimeCallEdge[],
		options: RuntimeJoinOptions,
	): RuntimeCallJoinResult {
		const byFile = RuntimeJoin.indexByFile(nodes);
		const filePaths = [...byFile.keys()];
		const aggregated = new Map<string, RuntimeEdge>();
		let matchedEdges = 0;
		let droppedEdges = 0;
		let droppedSamples = 0;

		for (const edge of callEdges) {
			const from = RuntimeJoin.resolveFrame(edge.caller, byFile, filePaths, options.root);
			const to = RuntimeJoin.resolveFrame(edge.callee, byFile, filePaths, options.root);
			if (from === undefined || to === undefined || from.id === to.id) {
				droppedEdges += 1;
				droppedSamples += edge.samples;
				continue;
			}
			const key = `${from.id}->${to.id}`;
			const existing = aggregated.get(key);
			if (existing === undefined) {
				aggregated.set(key, { from: from.id, to: to.id, samples: edge.samples });
			} else {
				existing.samples += edge.samples;
			}
			matchedEdges += 1;
		}

		return { edges: [...aggregated.values()], matchedEdges, droppedEdges, droppedSamples };
	}

	/** Resolves a single frame to its graph node — file path, then name-or-range within that file — or undefined. */
	private static resolveFrame(
		frame: FrameRef,
		byFile: Map<string, RuntimeTargetNode[]>,
		filePaths: string[],
		root: string,
	): RuntimeTargetNode | undefined {
		const filePath = RuntimeJoin.resolveFilePath(frame.url, root, byFile, filePaths);
		if (filePath === undefined) {
			return undefined;
		}
		return RuntimeJoin.resolveNode(byFile.get(filePath) ?? [], frame).node;
	}

	private static indexByFile(nodes: RuntimeTargetNode[]): Map<string, RuntimeTargetNode[]> {
		const byFile = new Map<string, RuntimeTargetNode[]>();
		for (const node of nodes) {
			const bucket = byFile.get(node.filePath);
			if (bucket === undefined) {
				byFile.set(node.filePath, [node]);
			} else {
				bucket.push(node);
			}
		}
		return byFile;
	}

	/**
	 * Resolves a frame to a node within its file, preferring a name match and
	 * falling back to an enclosing-range match.
	 */
	private static resolveNode(fileNodes: RuntimeTargetNode[], frame: FrameRef): NodeResolution {
		const nameMatches = RuntimeJoin.nameMatches(fileNodes, frame.functionName);
		if (nameMatches.length === 1) {
			return { node: nameMatches[0], via: 'name' };
		}
		if (nameMatches.length > 1) {
			const disambiguated = RuntimeJoin.enclosingNode(nameMatches, frame.line);
			if (disambiguated !== undefined) {
				return { node: disambiguated, via: 'name' };
			}
			return { node: undefined, reason: 'ambiguous' };
		}
		const enclosed = RuntimeJoin.enclosingNode(fileNodes, frame.line);
		if (enclosed !== undefined) {
			return { node: enclosed, via: 'range' };
		}
		return { node: undefined, reason: 'no-node' };
	}

	/**
	 * Nodes in the file whose name equals the frame's function name (or its final
	 * dotted segment, so `Widget.render` matches a method named `render`). V8
	 * synthetic frames such as `(anonymous)` and `(root)` never match.
	 */
	private static nameMatches(fileNodes: RuntimeTargetNode[], functionName: string): RuntimeTargetNode[] {
		if (RuntimeJoin.isMeaningfulName(functionName) === false) {
			return [];
		}
		const candidates = RuntimeJoin.candidateNames(functionName);
		return fileNodes.filter((node) => NAME_MATCH_KINDS.has(node.kind) && candidates.includes(node.name));
	}

	private static isMeaningfulName(functionName: string): boolean {
		return functionName.length > 0 && functionName.startsWith('(') === false;
	}

	private static candidateNames(functionName: string): string[] {
		const dot = functionName.lastIndexOf('.');
		if (dot >= 0 && dot < functionName.length - 1) {
			return [functionName, functionName.slice(dot + 1)];
		}
		return [functionName];
	}

	/**
	 * Picks the innermost node whose range encloses `line`. Ties on range width
	 * break toward the later-starting node, which is the more deeply nested
	 * declaration. A non-positive line (V8 synthetic frame, or a transpiler that
	 * collapsed line numbers) encloses nothing.
	 */
	private static enclosingNode(nodes: RuntimeTargetNode[], line: number): RuntimeTargetNode | undefined {
		if (line < 1) {
			return undefined;
		}
		let best: RuntimeTargetNode | undefined;
		let bestSpan = Number.POSITIVE_INFINITY;
		for (const node of nodes) {
			if (node.startLine < 1 || node.endLine < node.startLine) {
				continue;
			}
			if (line < node.startLine || line > node.endLine) {
				continue;
			}
			const span = node.endLine - node.startLine;
			if (span < bestSpan || (span === bestSpan && best !== undefined && node.startLine > best.startLine)) {
				best = node;
				bestSpan = span;
			}
		}
		return best;
	}

	/**
	 * Maps a profile frame url to a graph `filePath`. Node-internal and empty
	 * urls (`node:`, `(root)`, `(idle)`) resolve to nothing. A url inside `root`
	 * resolves by relative path; otherwise a unique path-suffix match is used so
	 * a graph extracted under a different absolute prefix still attaches.
	 */
	private static resolveFilePath(
		url: string,
		root: string,
		byFile: Map<string, RuntimeTargetNode[]>,
		filePaths: string[],
	): string | undefined {
		if (url.length === 0 || url.startsWith('node:')) {
			return undefined;
		}
		const absolute = RuntimeJoin.urlToAbsolute(url);
		if (absolute === undefined) {
			return byFile.has(url) ? url : undefined;
		}
		const normalizedAbsolute = RuntimeJoin.toPosix(absolute);

		const candidate = RuntimeJoin.toPosix(relative(root, absolute));
		if (candidate.length > 0 && candidate.startsWith('..') === false && isAbsolute(candidate) === false && byFile.has(candidate)) {
			return candidate;
		}

		let suffixMatch: string | undefined;
		for (const filePath of filePaths) {
			if (normalizedAbsolute === filePath || normalizedAbsolute.endsWith(`/${filePath}`)) {
				if (suffixMatch !== undefined && suffixMatch !== filePath) {
					return undefined;
				}
				suffixMatch = filePath;
			}
		}
		return suffixMatch;
	}

	private static urlToAbsolute(url: string): string | undefined {
		if (url.startsWith('file://')) {
			return fileURLToPath(url);
		}
		if (isAbsolute(url)) {
			return url;
		}
		return undefined;
	}

	private static toPosix(value: string): string {
		return sep === '/' ? value : value.split(sep).join('/');
	}

	private static recordDrop(
		dropped: Map<string, DroppedFrameGroup>,
		frame: FrameSample,
		reason: 'no-file' | 'no-node' | 'ambiguous',
	): void {
		const label = RuntimeJoin.dropLabel(frame, reason);
		const key = `${reason}:${label}`;
		const group = dropped.get(key) ?? { label, reason, samples: 0, selfMicros: 0 };
		group.samples += frame.samples;
		group.selfMicros += frame.selfMicros;
		dropped.set(key, group);
	}

	private static dropLabel(frame: FrameSample, reason: 'no-file' | 'no-node' | 'ambiguous'): string {
		const name = frame.functionName.length > 0 ? frame.functionName : '(anonymous)';
		if (reason === 'no-file') {
			return frame.url.length === 0 ? name : `${name} ${frame.url}`;
		}
		return `${name} ${frame.url}:${frame.line}`;
	}
}
