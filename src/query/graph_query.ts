import type { KuzuValue } from 'kuzu';
import { REFERENCE_EDGE_KINDS } from '../schema/edge.js';
import { RUNTIME_MANIFEST_KEY, RuntimeManifest, RuntimeManifestSchema } from '../schema/runtime_manifest.js';
import { KuzuStore, StoredNode } from '../store/kuzu_store.js';

export type SymbolRef = {
	id: string;
	kind: string;
	name: string;
	filePath: string;
	startLine: number;
	metadata: Record<string, unknown>;
};

export type NeighborRef = SymbolRef & {
	edgeKind: string;
	edgeMetadata: Record<string, unknown>;
	direction: 'in' | 'out';
};

/**
 * The metric a {@link GraphQuery.hotspots} ranking is computed against.
 *
 * - `self-time` / `samples` — measured runtime from `metadata.runtime`, present
 *   only after `enrich`.
 * - `callers` — inbound `CALLS` edge count (static fan-in / centrality).
 * - `call-count` — sum of inbound `CALLS` edge `metadata.count` (how often a
 *   symbol is actually invoked across all call sites in source).
 * - `blast-radius` — transitive inbound `CALLS` size (change-risk / centrality).
 */
export type HotspotMetric = 'self-time' | 'samples' | 'callers' | 'call-count' | 'blast-radius';

/** A ranked node, carrying the score it earned and the metric it was scored by. */
export type HotspotRef = SymbolRef & {
	score: number;
	metric: HotspotMetric;
};

export type HotspotOptions = {
	/** Metric to rank by. Defaults to `self-time` when the graph is enriched, `callers` otherwise. */
	by?: HotspotMetric;
	/** Maximum number of hotspots to return. Defaults to 20, clamped to [1, 1000]. */
	limit?: number;
	/** Restrict ranking to nodes that carry `metadata.runtime`. */
	measuredOnly?: boolean;
};

/**
 * The result of a hotspot ranking: the top-N nodes plus the context needed to
 * interpret them — the metric actually used, what was requested, and whether a
 * runtime metric fell back to a static one because the graph is un-enriched.
 */
export type HotspotReport = {
	/** The metric actually used to rank (differs from `requested` only after a fallback). */
	metric: HotspotMetric;
	/** The metric the caller asked for, or the resolved default when none was given. */
	requested: HotspotMetric;
	/** Whether any node in the graph carries `metadata.runtime`. */
	enriched: boolean;
	/** True when a runtime metric was requested on an un-enriched graph, so `metric` fell back to `callers`. */
	fellBack: boolean;
	/** Whether ranking was restricted to measured nodes. */
	measuredOnly: boolean;
	/** Top-N nodes by `metric`, descending, each carrying its `score`. */
	hotspots: HotspotRef[];
};

/**
 * The measured weight {@link GraphQuery.costRanking} and
 * {@link GraphQuery.costAttribution} propagate along `CALLS` edges. Both read
 * `metadata.runtime`, present only after `enrich`:
 * - `self-time` — `metadata.runtime.selfMs`.
 * - `samples` — `metadata.runtime.samples`.
 */
export type CostMetric = 'self-time' | 'samples';

/**
 * Which call graph cost propagates along:
 * - `static` — the `CALLS` edges parsed from source, weighted by call-site `count` (default).
 * - `runtime` — the `CALLS_RUNTIME` edges `enrich` records, weighted by sample flow:
 *   the call graph as it actually ran, so a hot-loop caller outweighs a cold one.
 *   Falls back to `static` when the graph has no runtime call edges.
 */
export type CostFlowGraph = 'static' | 'runtime';

/**
 * A node carrying its propagated cost. `selfCost` is the measured *exclusive*
 * cost (time in the node itself); `inclusiveCost` adds the cost attributed from
 * everything it transitively calls; `shareOfTotal` is `inclusiveCost` as a
 * fraction of the graph's total self cost — the "responsible for X% of total"
 * number. `cyclic`/`cycleSize` flag membership in a call cycle, whose members
 * share the cycle's total inclusive cost.
 */
export type CostRef = SymbolRef & {
	selfCost: number;
	inclusiveCost: number;
	shareOfTotal: number;
	cyclic: boolean;
	cycleSize: number;
};

export type CostOptions = {
	/** Metric to propagate. Defaults to `self-time`. */
	by?: CostMetric;
	/** Call graph to propagate along. Defaults to `static`. */
	edges?: CostFlowGraph;
	/** Maximum number of ranked nodes to return. Defaults to 20, clamped to [1, 1000]. */
	limit?: number;
};

/**
 * A ranking of nodes by inclusive cost, with the context needed to read it: the
 * metric propagated, whether the graph is enriched at all, and the total self
 * cost that `shareOfTotal` is a fraction of.
 */
export type CostReport = {
	/** The metric propagated. */
	metric: CostMetric;
	/** The call graph cost propagated along. */
	edges: CostFlowGraph;
	/** True when `runtime` edges were requested but the graph had none, so it fell back to `static`. */
	fellBack: boolean;
	/** Whether any node in the graph carries `metadata.runtime`. */
	enriched: boolean;
	/** Σ self cost over every node — the denominator behind `shareOfTotal`. */
	totalSelf: number;
	/** Count of nodes that carry runtime metrics. */
	measuredNodes: number;
	/**
	 * Fraction of the profiled cost (in `metric`) that the join attributed to graph
	 * nodes, from the `enrich` manifest — the share of total measured cost this
	 * attribution actually accounts for. `null` when the graph carries no manifest
	 * (never enriched, or enriched before manifests were recorded).
	 */
	coverage: number | null;
	/** Nodes by `inclusiveCost`, descending, top-N, zero-cost nodes omitted. */
	nodes: CostRef[];
};

/**
 * One edge of a {@link CostAttribution}: a caller or callee of the focal node,
 * carrying the cost attributed across that edge and its share of the focal
 * node's inclusive cost.
 */
export type CostFlow = SymbolRef & {
	/** Cost attributed along this edge, in the report's metric. */
	amount: number;
	/** `amount` as a fraction of the focal node's inclusive cost, in [0, 1]. */
	share: number;
	/** The propagation weight — the static call-site count, or runtime samples with `--edges runtime`. */
	callCount: number;
};

/**
 * A per-node causal breakdown. `callees` is where the focal node's inclusive
 * cost goes (the cost each callee's subtree contributes); `callers` is who is
 * responsible for the focal node's cost (how it is attributed upward). `node` is
 * null when the id resolves to no graph node.
 */
export type CostAttribution = {
	metric: CostMetric;
	edges: CostFlowGraph;
	fellBack: boolean;
	enriched: boolean;
	totalSelf: number;
	/** Fraction of profiled cost attributed to graph nodes, or `null` without a manifest (see {@link CostReport.coverage}). */
	coverage: number | null;
	node: CostRef | null;
	callees: CostFlow[];
	callers: CostFlow[];
};

/** One inbound `CALLS` edge reduced to the fields the ranking needs. */
type CallEdge = {
	fromId: string;
	toId: string;
	count: number;
};

/**
 * The propagated cost model computed once from the whole graph: per-node self and
 * inclusive cost and cycle membership, plus the call adjacency and inbound
 * weights needed to attribute it. Keyed by node id.
 */
type CostModel = {
	totalSelf: number;
	measuredNodes: number;
	selfCost: Map<string, number>;
	inclusiveCost: Map<string, number>;
	componentOf: Map<string, number>;
	cycleSize: Map<string, number>;
	externalInbound: Map<string, number>;
	outEdges: Map<string, CallEdge[]>;
	inEdges: Map<string, CallEdge[]>;
};

/**
 * The {@link REFERENCE_EDGE_KINDS} set rendered as a Cypher list literal — e.g.
 * `['CALLS', 'EXTENDS', …]` — for interpolation into `kind IN …` predicates. The
 * schema array is the single source of truth; this is its query-side projection.
 */
const REFERENCE_EDGE_KINDS_CYPHER = `[${REFERENCE_EDGE_KINDS.map((kind) => `'${kind}'`).join(', ')}]`;

const RETURN_REF = (variable: string): string =>
	`${variable}.id AS id, ${variable}.kind AS kind, ${variable}.name AS name, ${variable}.filePath AS filePath, ${variable}.startLine AS startLine, ${variable}.metadata AS metadata`;

/**
 * Kùzu's hard ceiling on the upper bound of a variable-length relationship: a
 * pattern like `-[e:Edge*1..N]-` with `N > 30` is rejected by the binder at query
 * time. {@link GraphQuery.clampDepth} caps `--depth` here so the bound it
 * interpolates into {@link GraphQuery.blastRadius} is always one Kùzu accepts.
 */
const KUZU_MAX_REL_BOUND = 30;

export class GraphQuery {
	private readonly store: KuzuStore;

	constructor(store: KuzuStore) {
		this.store = store;
	}

	async whoCalls(id: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode {id: $id})
			WHERE e.kind = 'CALLS'
			RETURN ${RETURN_REF('caller')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async calls(id: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode {id: $id})-[e:Edge]->(callee:GraphNode)
			WHERE e.kind = 'CALLS'
			RETURN ${RETURN_REF('callee')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async blastRadius(id: string, depth: number): Promise<SymbolRef[]> {
		const bound = GraphQuery.clampDepth(depth);
		const rows = await this.store.run(
			`MATCH (target:GraphNode {id: $id})<-[e:Edge*1..${bound} (r, n | WHERE r.kind = 'CALLS')]-(impacted:GraphNode)
			RETURN DISTINCT ${RETURN_REF('impacted')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async deadExports(): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode)
			WHERE n.exported = true
			OPTIONAL MATCH (n)<-[selfRef:Edge]-(:GraphNode)
			WHERE selfRef.kind IN ${REFERENCE_EDGE_KINDS_CYPHER}
			WITH n, count(selfRef) AS selfRefs
			OPTIONAL MATCH (n)-[c:Edge]->(member:GraphNode)<-[memberRef:Edge]-(:GraphNode)
			WHERE c.kind = 'CONTAINS' AND memberRef.kind IN ${REFERENCE_EDGE_KINDS_CYPHER}
			WITH n, selfRefs, count(memberRef) AS memberRefs
			WHERE selfRefs = 0 AND memberRefs = 0
			RETURN ${RETURN_REF('n')}
			ORDER BY filePath, startLine`,
		);
		return GraphQuery.toRefs(rows);
	}

	/**
	 * Returns the call cycles in the graph: every strongly-connected component of
	 * the static `CALLS` graph with more than one member, as the list of its
	 * symbols, largest cycle first. A purely static structural signal — it needs no
	 * runtime data — that surfaces mutual-recursion tangles which are hard to spot
	 * by eye. Reuses the same SCC pass {@link GraphQuery.computeCostModel} relies on.
	 */
	async strongCycles(): Promise<SymbolRef[][]> {
		const nodes = await this.store.readNodes();
		const edges = await this.readCallEdges();
		const indexOf = new Map<string, number>();
		nodes.forEach((node, index) => indexOf.set(node.id, index));
		const successors: number[][] = nodes.map(() => []);
		for (const edge of edges) {
			const from = indexOf.get(edge.fromId);
			const to = indexOf.get(edge.toId);
			if (from === undefined || to === undefined || from === to) {
				continue;
			}
			successors[from].push(to);
		}
		const { componentOf, componentCount } = GraphQuery.stronglyConnectedComponents(successors);
		const members: number[][] = Array.from({ length: componentCount }, () => []);
		componentOf.forEach((component, index) => members[component].push(index));
		return members
			.filter((group) => group.length > 1)
			.map((group) => group.map((index) => GraphQuery.symbolOf(nodes[index])))
			.sort((a, b) => b.length - a.length);
	}

	async references(id: string): Promise<NeighborRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode {id: $id})<-[e:Edge]-(other:GraphNode)
			WHERE e.kind IN ${REFERENCE_EDGE_KINDS_CYPHER}
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind, e.metadata AS edgeMetadata
			ORDER BY edgeKind, filePath, startLine`,
			{ id },
		);
		return rows.map((row) => GraphQuery.toNeighbor(row, 'in'));
	}

	async neighborhood(id: string): Promise<NeighborRef[]> {
		const outgoing = await this.store.run(
			`MATCH (center:GraphNode {id: $id})-[e:Edge]->(other:GraphNode)
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind, e.metadata AS edgeMetadata`,
			{ id },
		);
		const incoming = await this.store.run(
			`MATCH (center:GraphNode {id: $id})<-[e:Edge]-(other:GraphNode)
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind, e.metadata AS edgeMetadata`,
			{ id },
		);
		return [
			...outgoing.map((row) => GraphQuery.toNeighbor(row, 'out')),
			...incoming.map((row) => GraphQuery.toNeighbor(row, 'in')),
		];
	}

	/**
	 * Resolves a search pattern to nodes, matching either a substring of the node
	 * name or an exact (case-insensitive) node kind. The kind match makes the
	 * system-level kinds discoverable as a set — `find Endpoint`, `find ConfigFlag`,
	 * `find ExternalAPI` — since their names are values (a route path, a host) rather
	 * than the kind itself. `Module` nodes are always excluded.
	 */
	async find(pattern: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode)
			WHERE n.kind <> 'Module' AND (lower(n.name) CONTAINS lower($pattern) OR lower(n.kind) = lower($pattern))
			RETURN ${RETURN_REF('n')}
			ORDER BY filePath, startLine
			LIMIT 50`,
			{ pattern },
		);
		return GraphQuery.toRefs(rows);
	}

	/**
	 * Ranks nodes by optimization leverage, returning the top-N for a chosen
	 * metric alongside the context needed to read the result.
	 *
	 * Runtime metrics (`self-time`, `samples`) read `metadata.runtime`; static
	 * metrics (`callers`, `call-count`, `blast-radius`) are derived from the
	 * inbound `CALLS` graph. The whole graph is read once (nodes, and the call
	 * edges when a static metric is used) and ranked in memory rather than per
	 * node, so `blast-radius` does not fan out into one traversal per node.
	 *
	 * The default metric is `self-time` on an enriched graph and `callers`
	 * otherwise. Asking for a runtime metric on an un-enriched graph does not
	 * return empty: it falls back to `callers` and flags `fellBack` so the caller
	 * can say so. Nodes that score zero on the chosen metric are omitted — a
	 * symbol nothing calls is not a fan-in hotspot.
	 */
	async hotspots(options: HotspotOptions = {}): Promise<HotspotReport> {
		const nodes = await this.store.readNodes();
		const enriched = nodes.some((node) => GraphQuery.hasRuntime(node.metadata));
		const requested: HotspotMetric = options.by ?? (enriched === true ? 'self-time' : 'callers');
		const fellBack = GraphQuery.isRuntimeMetric(requested) === true && enriched === false;
		const metric: HotspotMetric = fellBack === true ? 'callers' : requested;
		const measuredOnly = options.measuredOnly === true;
		const limit = GraphQuery.clampLimit(options.limit);

		const scores = await this.scoreNodes(nodes, metric);
		const candidates = measuredOnly === true
			? nodes.filter((node) => GraphQuery.hasRuntime(node.metadata))
			: nodes;

		const hotspots = candidates
			.map((node) => ({ node, score: scores.get(node.id) ?? 0 }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) =>
				b.score - a.score
				|| a.node.filePath.localeCompare(b.node.filePath)
				|| a.node.startLine - b.node.startLine)
			.slice(0, limit)
			.map((entry) => GraphQuery.toHotspot(entry.node, entry.score, metric));

		return { metric, requested, enriched, fellBack, measuredOnly, hotspots };
	}

	/**
	 * Ranks nodes by **inclusive cost** — self cost plus the cost attributed from
	 * everything a node transitively calls — and reports each node's share of the
	 * graph's total self cost. This is the causal counterpart to {@link hotspots}'
	 * `self-time` ranking: where hotspots asks "where is time spent?", this asks
	 * "who is *responsible* for the time spent?".
	 *
	 * Cost propagates along `CALLS` edges, each callee's inclusive cost partitioned
	 * among its callers in proportion to call-site `count`, so cost is conserved (a
	 * diamond is not double-counted) and `shareOfTotal` is a true fraction. Call
	 * cycles are collapsed and their members share the cycle's total. The whole
	 * graph is read once and propagated in memory.
	 *
	 * Cost is inherently a runtime quantity: on an un-enriched graph there is no
	 * self cost to propagate, so `nodes` is empty and `enriched` is false — there is
	 * no static fallback (unlike {@link hotspots}).
	 */
	async costRanking(options: CostOptions = {}): Promise<CostReport> {
		const nodes = await this.store.readNodes();
		const enriched = nodes.some((node) => GraphQuery.hasRuntime(node.metadata));
		const metric: CostMetric = options.by ?? 'self-time';
		const limit = GraphQuery.clampLimit(options.limit);
		const flow = await this.resolveFlowEdges(options.edges ?? 'static');
		const manifest = await this.readRuntimeManifest();
		const model = GraphQuery.computeCostModel(nodes, flow.edges, metric);

		const ranked = nodes
			.map((node) => GraphQuery.toCostRef(node, model))
			.filter((ref) => ref.inclusiveCost > 0)
			.sort((a, b) =>
				b.inclusiveCost - a.inclusiveCost
				|| a.filePath.localeCompare(b.filePath)
				|| a.startLine - b.startLine)
			.slice(0, limit);

		return {
			metric,
			edges: flow.flow,
			fellBack: flow.fellBack,
			enriched,
			totalSelf: model.totalSelf,
			measuredNodes: model.measuredNodes,
			coverage: GraphQuery.coverageFor(manifest, metric),
			nodes: ranked,
		};
	}

	/**
	 * Breaks one node's cost down causally: where its inclusive cost goes
	 * (`callees`, each carrying the cost its subtree contributes) and who is
	 * responsible for it (`callers`, how the node's cost is attributed upward by
	 * call-count share). Both are derived from the same propagation
	 * {@link costRanking} uses. Returns `node: null` when the id resolves to no node.
	 */
	async costAttribution(id: string, options: CostOptions = {}): Promise<CostAttribution> {
		const nodes = await this.store.readNodes();
		const enriched = nodes.some((node) => GraphQuery.hasRuntime(node.metadata));
		const metric: CostMetric = options.by ?? 'self-time';
		const flow = await this.resolveFlowEdges(options.edges ?? 'static');
		const manifest = await this.readRuntimeManifest();
		const model = GraphQuery.computeCostModel(nodes, flow.edges, metric);
		const nodeById = new Map(nodes.map((node) => [node.id, node]));
		const coverage = GraphQuery.coverageFor(manifest, metric);

		const focal = nodeById.get(id);
		if (focal === undefined) {
			return { metric, edges: flow.flow, fellBack: flow.fellBack, enriched, totalSelf: model.totalSelf, coverage, node: null, callees: [], callers: [] };
		}

		const focalRef = GraphQuery.toCostRef(focal, model);
		const focalComponent = model.componentOf.get(id);
		const focalInclusive = focalRef.inclusiveCost;
		const focalInbound = model.externalInbound.get(id) ?? 0;

		const callees: CostFlow[] = [];
		for (const edge of model.outEdges.get(id) ?? []) {
			if (model.componentOf.get(edge.toId) === focalComponent) {
				continue;
			}
			const callee = nodeById.get(edge.toId);
			if (callee === undefined) {
				continue;
			}
			const inbound = model.externalInbound.get(edge.toId) ?? 0;
			const calleeInclusive = model.inclusiveCost.get(edge.toId) ?? 0;
			const amount = inbound > 0 ? calleeInclusive * edge.count / inbound : 0;
			const share = focalInclusive > 0 ? amount / focalInclusive : 0;
			callees.push({ ...GraphQuery.symbolOf(callee), amount, share, callCount: edge.count });
		}

		const callers: CostFlow[] = [];
		for (const edge of model.inEdges.get(id) ?? []) {
			if (model.componentOf.get(edge.fromId) === focalComponent) {
				continue;
			}
			const caller = nodeById.get(edge.fromId);
			if (caller === undefined) {
				continue;
			}
			const amount = focalInbound > 0 ? focalInclusive * edge.count / focalInbound : 0;
			const share = focalInbound > 0 ? edge.count / focalInbound : 0;
			callers.push({ ...GraphQuery.symbolOf(caller), amount, share, callCount: edge.count });
		}

		callees.sort((a, b) => b.amount - a.amount || a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
		callers.sort((a, b) => b.amount - a.amount || a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);

		return { metric, edges: flow.flow, fellBack: flow.fellBack, enriched, totalSelf: model.totalSelf, coverage, node: focalRef, callees, callers };
	}

	/**
	 * Reads the runtime ingest manifest `enrich` records at the graph level, or
	 * null when the graph carries none (never enriched, or enriched before manifests
	 * were recorded). A stored value that fails validation is treated as absent.
	 */
	private async readRuntimeManifest(): Promise<RuntimeManifest | null> {
		const raw = await this.store.readGraphMeta(RUNTIME_MANIFEST_KEY);
		if (raw === null) {
			return null;
		}
		const parsed = RuntimeManifestSchema.safeParse(raw);
		return parsed.success === true ? parsed.data : null;
	}

	/** Builds a node-id → score map for the chosen metric, reading call edges only when a static metric needs them. */
	private async scoreNodes(nodes: StoredNode[], metric: HotspotMetric): Promise<Map<string, number>> {
		if (metric === 'self-time' || metric === 'samples') {
			const key = metric === 'self-time' ? 'selfMs' : 'samples';
			return new Map(nodes.map((node) => [node.id, GraphQuery.runtimeValue(node.metadata, key)]));
		}
		const edges = await this.readCallEdges();
		if (metric === 'call-count') {
			return GraphQuery.sumInbound(edges, (edge) => edge.count);
		}
		if (metric === 'blast-radius') {
			return GraphQuery.blastRadiusSizes(nodes, edges);
		}
		return GraphQuery.sumInbound(edges, () => 1);
	}

	/** Reads every `CALLS` edge with its call-site `count` decoded from edge metadata. */
	private async readCallEdges(): Promise<CallEdge[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode)
			WHERE e.kind = 'CALLS'
			RETURN caller.id AS fromId, callee.id AS toId, e.metadata AS metadata`,
		);
		return rows.map((row) => ({
			fromId: String(row.fromId),
			toId: String(row.toId),
			count: GraphQuery.callCount(row.metadata),
		}));
	}

	/**
	 * Resolves the call graph cost propagates along. `runtime` reads the
	 * `CALLS_RUNTIME` edges `enrich` records, weighted by sample flow; when the
	 * graph has none (un-enriched, or a profile that captured no in-project calls)
	 * it falls back to the static `CALLS` graph and flags it.
	 */
	private async resolveFlowEdges(requested: CostFlowGraph): Promise<{ edges: CallEdge[]; flow: CostFlowGraph; fellBack: boolean }> {
		if (requested === 'runtime') {
			const runtime = await this.readRuntimeCallEdges();
			if (runtime.length > 0) {
				return { edges: runtime, flow: 'runtime', fellBack: false };
			}
			return { edges: await this.readCallEdges(), flow: 'static', fellBack: true };
		}
		return { edges: await this.readCallEdges(), flow: 'static', fellBack: false };
	}

	/** Reads every `CALLS_RUNTIME` edge with its runtime `samples` as the propagation weight. */
	private async readRuntimeCallEdges(): Promise<CallEdge[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode)
			WHERE e.kind = 'CALLS_RUNTIME'
			RETURN caller.id AS fromId, callee.id AS toId, e.metadata AS metadata`,
		);
		return rows.map((row) => ({
			fromId: String(row.fromId),
			toId: String(row.toId),
			count: GraphQuery.edgeSamples(row.metadata),
		}));
	}

	/** Sums a per-edge weight onto each edge's target, yielding inbound fan-in (`weight = 1`) or call-count (`weight = count`). */
	private static sumInbound(edges: CallEdge[], weight: (edge: CallEdge) => number): Map<string, number> {
		const totals = new Map<string, number>();
		for (const edge of edges) {
			totals.set(edge.toId, (totals.get(edge.toId) ?? 0) + weight(edge));
		}
		return totals;
	}

	/** Computes, for every node, the number of distinct nodes that transitively reach it through inbound `CALLS`. */
	private static blastRadiusSizes(nodes: StoredNode[], edges: CallEdge[]): Map<string, number> {
		const callers = new Map<string, string[]>();
		for (const edge of edges) {
			const bucket = callers.get(edge.toId);
			if (bucket === undefined) {
				callers.set(edge.toId, [edge.fromId]);
			} else {
				bucket.push(edge.fromId);
			}
		}
		const sizes = new Map<string, number>();
		for (const node of nodes) {
			sizes.set(node.id, GraphQuery.reachableCount(node.id, callers));
		}
		return sizes;
	}

	/** Counts the distinct ancestors of `start` over the reverse-call adjacency, cycle-safe and excluding `start` itself. */
	private static reachableCount(start: string, callers: Map<string, string[]>): number {
		const visited = new Set<string>();
		const stack = [...(callers.get(start) ?? [])];
		while (stack.length > 0) {
			const id = stack.pop();
			if (id === undefined || visited.has(id) === true) {
				continue;
			}
			visited.add(id);
			for (const next of callers.get(id) ?? []) {
				if (visited.has(next) === false) {
					stack.push(next);
				}
			}
		}
		visited.delete(start);
		return visited.size;
	}

	/**
	 * Propagates self cost into inclusive cost over the whole graph in one pass.
	 *
	 * Self-edges and edges touching unknown nodes are dropped. Strongly-connected
	 * components (call cycles) are collapsed with Tarjan's algorithm, which numbers
	 * them in reverse-topological order (a callee's component before its caller's);
	 * processing components in that order lets each caller read its callees'
	 * already-computed inclusive cost. A callee's inclusive cost is partitioned
	 * among its callers by call-site `count` over the inbound weight from *outside*
	 * its component, so cost is conserved on the acyclic part and a cycle's members
	 * share the cycle's total.
	 */
	private static computeCostModel(nodes: StoredNode[], edges: CallEdge[], metric: CostMetric): CostModel {
		const key = metric === 'self-time' ? 'selfMs' : 'samples';
		const count = nodes.length;
		const indexOf = new Map<string, number>();
		nodes.forEach((node, i) => indexOf.set(node.id, i));

		const self = nodes.map((node) => GraphQuery.runtimeValue(node.metadata, key));
		const successors: number[][] = nodes.map(() => []);
		const outEdges: { to: number; count: number }[][] = nodes.map(() => []);
		const inEdges: { from: number; count: number }[][] = nodes.map(() => []);
		for (const edge of edges) {
			const from = indexOf.get(edge.fromId);
			const to = indexOf.get(edge.toId);
			if (from === undefined || to === undefined || from === to) {
				continue;
			}
			successors[from].push(to);
			outEdges[from].push({ to, count: edge.count });
			inEdges[to].push({ from, count: edge.count });
		}

		const { componentOf, componentCount } = GraphQuery.stronglyConnectedComponents(successors);
		const componentSize = new Array<number>(componentCount).fill(0);
		const selfByComponent = new Array<number>(componentCount).fill(0);
		const members: number[][] = Array.from({ length: componentCount }, () => []);
		for (let i = 0; i < count; i += 1) {
			const comp = componentOf[i];
			componentSize[comp] += 1;
			selfByComponent[comp] += self[i];
			members[comp].push(i);
		}

		const externalInbound = new Array<number>(count).fill(0);
		for (let to = 0; to < count; to += 1) {
			for (const edge of inEdges[to]) {
				if (componentOf[edge.from] !== componentOf[to]) {
					externalInbound[to] += edge.count;
				}
			}
		}

		const inclusiveByComponent = new Array<number>(componentCount).fill(0);
		for (let comp = 0; comp < componentCount; comp += 1) {
			let inclusive = selfByComponent[comp];
			for (const member of members[comp]) {
				for (const edge of outEdges[member]) {
					const target = componentOf[edge.to];
					if (target === comp) {
						continue;
					}
					const inbound = externalInbound[edge.to];
					if (inbound > 0) {
						inclusive += inclusiveByComponent[target] * edge.count / inbound;
					}
				}
			}
			inclusiveByComponent[comp] = inclusive;
		}

		const model: CostModel = {
			totalSelf: 0,
			measuredNodes: 0,
			selfCost: new Map(),
			inclusiveCost: new Map(),
			componentOf: new Map(),
			cycleSize: new Map(),
			externalInbound: new Map(),
			outEdges: new Map(),
			inEdges: new Map(),
		};
		for (let i = 0; i < count; i += 1) {
			const node = nodes[i];
			const comp = componentOf[i];
			model.totalSelf += self[i];
			if (GraphQuery.hasRuntime(node.metadata) === true) {
				model.measuredNodes += 1;
			}
			model.selfCost.set(node.id, self[i]);
			model.inclusiveCost.set(node.id, inclusiveByComponent[comp]);
			model.componentOf.set(node.id, comp);
			model.cycleSize.set(node.id, componentSize[comp]);
			model.externalInbound.set(node.id, externalInbound[i]);
			model.outEdges.set(node.id, outEdges[i].map((edge) => ({ fromId: node.id, toId: nodes[edge.to].id, count: edge.count })));
			model.inEdges.set(node.id, inEdges[i].map((edge) => ({ fromId: nodes[edge.from].id, toId: node.id, count: edge.count })));
		}
		return model;
	}

	/**
	 * Tarjan's strongly-connected components over the index-based successor lists,
	 * iterative so a deep call chain cannot overflow the stack. Components are
	 * numbered in the order they are finalized, which is reverse-topological: every
	 * cross-component edge runs from a higher-numbered component to a lower one.
	 */
	private static stronglyConnectedComponents(successors: number[][]): { componentOf: number[]; componentCount: number } {
		const count = successors.length;
		const index = new Array<number>(count).fill(-1);
		const lowlink = new Array<number>(count).fill(0);
		const onStack = new Array<boolean>(count).fill(false);
		const componentOf = new Array<number>(count).fill(-1);
		const sccStack: number[] = [];
		const workNode: number[] = [];
		const workNext: number[] = [];
		let counter = 0;
		let componentCount = 0;

		for (let start = 0; start < count; start += 1) {
			if (index[start] !== -1) {
				continue;
			}
			workNode.push(start);
			workNext.push(0);
			index[start] = counter;
			lowlink[start] = counter;
			counter += 1;
			sccStack.push(start);
			onStack[start] = true;

			while (workNode.length > 0) {
				const node = workNode[workNode.length - 1];
				const position = workNext[workNext.length - 1];
				const succ = successors[node];
				if (position < succ.length) {
					workNext[workNext.length - 1] = position + 1;
					const next = succ[position];
					if (index[next] === -1) {
						index[next] = counter;
						lowlink[next] = counter;
						counter += 1;
						sccStack.push(next);
						onStack[next] = true;
						workNode.push(next);
						workNext.push(0);
					} else if (onStack[next] === true && index[next] < lowlink[node]) {
						lowlink[node] = index[next];
					}
					continue;
				}
				if (lowlink[node] === index[node]) {
					let member = -1;
					do {
						const popped = sccStack.pop();
						member = popped === undefined ? node : popped;
						onStack[member] = false;
						componentOf[member] = componentCount;
					} while (member !== node);
					componentCount += 1;
				}
				workNode.pop();
				workNext.pop();
				if (workNode.length > 0) {
					const parent = workNode[workNode.length - 1];
					if (lowlink[node] < lowlink[parent]) {
						lowlink[parent] = lowlink[node];
					}
				}
			}
		}
		return { componentOf, componentCount };
	}

	private static toCostRef(node: StoredNode, model: CostModel): CostRef {
		const selfCost = model.selfCost.get(node.id) ?? 0;
		const inclusiveCost = model.inclusiveCost.get(node.id) ?? 0;
		const cycleSize = model.cycleSize.get(node.id) ?? 1;
		return {
			...GraphQuery.symbolOf(node),
			selfCost,
			inclusiveCost,
			shareOfTotal: model.totalSelf > 0 ? inclusiveCost / model.totalSelf : 0,
			cyclic: cycleSize > 1,
			cycleSize,
		};
	}

	private static symbolOf(node: StoredNode): SymbolRef {
		return {
			id: node.id,
			kind: node.kind,
			name: node.name,
			filePath: node.filePath,
			startLine: node.startLine,
			metadata: node.metadata,
		};
	}

	/**
	 * The fraction of profiled cost (in `metric`) the join attributed to graph
	 * nodes, from the manifest: matched ÷ total. Null when there is no manifest or
	 * the profile measured nothing in that metric.
	 */
	private static coverageFor(manifest: RuntimeManifest | null, metric: CostMetric): number | null {
		if (manifest === null) {
			return null;
		}
		if (metric === 'samples') {
			return manifest.totalSamples > 0 ? manifest.matchedSamples / manifest.totalSamples : null;
		}
		return manifest.totalSelfMicros > 0 ? manifest.matchedSelfMicros / manifest.totalSelfMicros : null;
	}

	private static toHotspot(node: StoredNode, score: number, metric: HotspotMetric): HotspotRef {
		return {
			id: node.id,
			kind: node.kind,
			name: node.name,
			filePath: node.filePath,
			startLine: node.startLine,
			metadata: node.metadata,
			score,
			metric,
		};
	}

	private static isRuntimeMetric(metric: HotspotMetric): boolean {
		return metric === 'self-time' || metric === 'samples';
	}

	/** Reads a numeric metric out of `metadata.runtime`, defaulting to 0 when absent or non-numeric. */
	private static runtimeValue(metadata: Record<string, unknown>, key: string): number {
		const runtime = metadata.runtime;
		if (typeof runtime !== 'object' || runtime === null) {
			return 0;
		}
		const value = (runtime as Record<string, unknown>)[key];
		return typeof value === 'number' ? value : 0;
	}

	private static hasRuntime(metadata: Record<string, unknown>): boolean {
		const runtime = metadata.runtime;
		return typeof runtime === 'object' && runtime !== null;
	}

	/** Decodes an edge's call-site `count`, defaulting to 1 (the minimum the builder records). */
	private static callCount(value: KuzuValue): number {
		const metadata = GraphQuery.parseMetadata(value);
		const count = metadata.count;
		return typeof count === 'number' && count > 0 ? count : 1;
	}

	/** Decodes a runtime call edge's `samples` weight, defaulting to 1 when absent. */
	private static edgeSamples(value: KuzuValue): number {
		const samples = GraphQuery.parseMetadata(value).samples;
		return typeof samples === 'number' && samples >= 0 ? samples : 1;
	}

	private static clampLimit(limit: number | undefined): number {
		if (limit === undefined || Number.isFinite(limit) === false) {
			return 20;
		}
		const floored = Math.floor(limit);
		if (floored < 1) {
			return 20;
		}
		return floored > 1000 ? 1000 : floored;
	}

	private static toRefs(rows: Record<string, KuzuValue>[]): SymbolRef[] {
		return rows.map((row) => GraphQuery.toRef(row));
	}

	private static toRef(row: Record<string, KuzuValue>): SymbolRef {
		return {
			id: String(row.id),
			kind: String(row.kind),
			name: String(row.name),
			filePath: String(row.filePath),
			startLine: Number(row.startLine),
			metadata: GraphQuery.parseMetadata(row.metadata),
		};
	}

	private static toNeighbor(row: Record<string, KuzuValue>, direction: 'in' | 'out'): NeighborRef {
		return {
			...GraphQuery.toRef(row),
			edgeKind: String(row.edgeKind),
			edgeMetadata: GraphQuery.parseMetadata(row.edgeMetadata),
			direction,
		};
	}

	/**
	 * Decodes the JSON `metadata` column back into a record. A missing, empty, or
	 * malformed value decodes to an empty object so callers always receive a record.
	 */
	private static parseMetadata(value: KuzuValue): Record<string, unknown> {
		if (typeof value !== 'string' || value.length === 0) {
			return {};
		}
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null) {
				return parsed as Record<string, unknown>;
			}
			return {};
		} catch {
			return {};
		}
	}

	private static clampDepth(depth: number): number {
		if (Number.isFinite(depth) === false) {
			return 5;
		}
		const floored = Math.floor(depth);
		if (floored < 1) {
			return 1;
		}
		return floored > KUZU_MAX_REL_BOUND ? KUZU_MAX_REL_BOUND : floored;
	}
}
