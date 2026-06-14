import { CLUSTERING_MANIFEST_KEY, COMMUNITY_LABEL_METADATA_KEY, COMMUNITY_METADATA_KEY } from '../cluster/graph_clusterer.js';
import { CostRef, GraphQuery, HotspotRef, SymbolRef } from '../query/graph_query.js';
import { SOURCE_MANIFEST_KEY, SourceManifest, SourceManifestSchema } from '../schema/source_manifest.js';
import { KuzuStore, StoredNode } from '../store/kuzu_store.js';

/** A graph symbol reduced to the fields every report section renders. */
export type ReportSymbol = {
	name: string;
	kind: string;
	filePath: string;
	startLine: number;
};

/** A {@link ReportSymbol} carrying the score it earned in a ranking. */
export type RankedSymbol = ReportSymbol & { score: number };

/** A {@link ReportSymbol} carrying its propagated cost, for the runtime sections. */
export type ReportCostNode = ReportSymbol & {
	selfCost: number;
	inclusiveCost: number;
	shareOfTotal: number;
	cyclic: boolean;
	cycleSize: number;
};

/** One row of the composition tables: a node or edge kind and how many carry it. */
export type KindCount = { kind: string; count: number };

/** A detected community, named by its label and sized by its membership. */
export type ReportCommunity = { label: string; size: number };

/** One call cycle: the strongly-connected component's size and its members. */
export type ReportCycle = { size: number; members: ReportSymbol[] };

/** The system-level surface area: routes handled, configuration read, hosts called. */
export type ReportBoundary = {
	endpoints: ReportSymbol[];
	configFlags: ReportSymbol[];
	externalApis: ReportSymbol[];
};

/**
 * The static-call-graph view set against the runtime profile. `orchestrators`
 * carry cost but spend ~none themselves; `hiddenHotspots` are hot yet have few
 * callers; `alignedCore` are both central and hot. Empty on an un-enriched graph.
 */
export type StructureVsRuntime = {
	orchestrators: ReportSymbol[];
	hiddenHotspots: ReportSymbol[];
	alignedCore: ReportSymbol[];
};

/** The complete, format-agnostic data a {@link GraphReport} renders. */
export type GraphReportData = {
	generatedAt: string;
	project: string;
	outputFolder: string;
	provenance: SourceManifest | null;
	semantic: boolean;
	enriched: boolean;
	coverage: number | null;
	totalSelf: number;
	limit: number;
	totals: {
		symbols: number;
		files: number;
		relationships: number;
		communities: number;
		deadExports: number;
		cycles: number;
	};
	verdict: string;
	nodeKinds: KindCount[];
	edgeKinds: KindCount[];
	hubsByCallers: RankedSymbol[];
	hubsByBlastRadius: RankedSymbol[];
	communityQuality: number | null;
	communities: ReportCommunity[];
	hotspots: RankedSymbol[];
	cost: ReportCostNode[];
	structureVsRuntime: StructureVsRuntime;
	cycles: ReportCycle[];
	boundary: ReportBoundary;
	deadExports: ReportSymbol[];
};

export type GatherOptions = {
	/** ISO date (YYYY-MM-DD) the command stamps; passed in so gathering stays pure of the clock. */
	generatedAt: string;
	/** Fallback project label when the graph records no source provenance. */
	project: string;
	/** The output folder, echoed into the copy-pasteable "where to go next" commands. */
	outputFolder: string;
	/** Top-N kept per ranking. */
	limit: number;
};

/** How many callers a symbol may have and still count as a "hidden" hotspot. */
const HIDDEN_HOTSPOT_MAX_CALLERS = 1;

/** A large bound used to read whole rankings before slicing them to `limit`. */
const UNBOUNDED = 100000;

/**
 * Gathers a {@link GraphReportData} from a loaded graph, reusing the existing
 * query surface (`hotspots`, `costRanking`, `deadExports`, `strongCycles`) plus a
 * few direct reads for composition and communities. Mirrors how the other
 * commands lean on {@link GraphQuery}; the rendering is left entirely to
 * {@link GraphReport}, so this stays presentation-free apart from the one-line
 * verdict it synthesises.
 */
export class ReportData {
	static async gather(store: KuzuStore, query: GraphQuery, options: GatherOptions): Promise<GraphReportData> {
		const nodes = await store.readNodes();
		const edgeKinds = await ReportData.edgeKindCounts(store);
		const provenance = await ReportData.readProvenance(store);
		const communityQuality = await ReportData.readCommunityQuality(store);

		const callers = await query.hotspots({ by: 'callers', limit: UNBOUNDED });
		const blast = await query.hotspots({ by: 'blast-radius', limit: UNBOUNDED });
		const selfTime = await query.hotspots({ by: 'self-time', limit: UNBOUNDED });
		const costReport = await query.costRanking({ limit: UNBOUNDED });
		const deadExports = await query.deadExports();
		const cycles = await query.strongCycles();

		const limit = options.limit;
		const enriched = costReport.enriched;
		const measured = enriched === true && selfTime.fellBack === false;
		const semantic = edgeKinds.some((entry) => entry.kind === 'CALLS' && entry.count > 0);

		const fanIn = new Map(callers.hotspots.map((hotspot) => [hotspot.id, hotspot.score]));
		const communities = ReportData.communitiesOf(nodes);

		const data: GraphReportData = {
			generatedAt: options.generatedAt,
			project: ReportData.projectName(provenance, options.project),
			outputFolder: options.outputFolder,
			provenance,
			semantic,
			enriched,
			coverage: costReport.coverage,
			totalSelf: costReport.totalSelf,
			limit,
			totals: {
				symbols: nodes.length,
				files: new Set(nodes.map((node) => node.filePath)).size,
				relationships: edgeKinds.reduce((sum, entry) => sum + entry.count, 0),
				communities: communities.length,
				deadExports: deadExports.length,
				cycles: cycles.length,
			},
			verdict: '',
			nodeKinds: ReportData.nodeKindCounts(nodes),
			edgeKinds,
			hubsByCallers: callers.hotspots.slice(0, limit).map(ReportData.toRanked),
			hubsByBlastRadius: blast.hotspots.slice(0, limit).map(ReportData.toRanked),
			communityQuality,
			communities: communities.slice(0, limit),
			hotspots: measured === true ? selfTime.hotspots.slice(0, limit).map(ReportData.toRanked) : [],
			cost: costReport.nodes.slice(0, limit).map(ReportData.toCostNode),
			structureVsRuntime: ReportData.synthesize(costReport.nodes, measured === true ? selfTime.hotspots : [], fanIn),
			cycles: cycles.slice(0, limit).map((members) => ({ size: members.length, members: members.map(ReportData.toSymbol) })),
			boundary: ReportData.boundaryOf(nodes),
			deadExports: deadExports.map(ReportData.toSymbol),
		};
		data.verdict = ReportData.verdictOf(data);
		return data;
	}

	private static async edgeKindCounts(store: KuzuStore): Promise<KindCount[]> {
		const rows = await store.run('MATCH (:GraphNode)-[e:Edge]->(:GraphNode) RETURN e.kind AS kind');
		return ReportData.countBy(rows.map((row) => String(row.kind)));
	}

	private static nodeKindCounts(nodes: StoredNode[]): KindCount[] {
		return ReportData.countBy(nodes.map((node) => node.kind));
	}

	private static countBy(values: string[]): KindCount[] {
		const counts = new Map<string, number>();
		for (const value of values) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([kind, count]) => ({ kind, count }))
			.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
	}

	/** Groups nodes by their assigned community index, labelled and sized, largest first. */
	private static communitiesOf(nodes: StoredNode[]): ReportCommunity[] {
		const sizes = new Map<number, number>();
		const labels = new Map<number, string>();
		for (const node of nodes) {
			const index = node.metadata[COMMUNITY_METADATA_KEY];
			if (typeof index !== 'number') {
				continue;
			}
			sizes.set(index, (sizes.get(index) ?? 0) + 1);
			const label = node.metadata[COMMUNITY_LABEL_METADATA_KEY];
			if (typeof label === 'string' && labels.has(index) === false) {
				labels.set(index, label);
			}
		}
		return [...sizes.entries()]
			.map(([index, size]) => ({ label: labels.get(index) ?? `community ${index}`, size }))
			.sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
	}

	private static boundaryOf(nodes: StoredNode[]): ReportBoundary {
		const of = (kind: string): ReportSymbol[] => nodes.filter((node) => node.kind === kind).map(ReportData.toSymbol);
		return { endpoints: of('Endpoint'), configFlags: of('ConfigFlag'), externalApis: of('ExternalAPI') };
	}

	/**
	 * Splits the measured graph into three reads of the same symbols: pure
	 * orchestrators (cost flows through, ~no self cost), hidden hotspots (hot, few
	 * callers), and the aligned core (central and hot).
	 */
	private static synthesize(cost: CostRef[], hottest: HotspotRef[], fanIn: Map<string, number>): StructureVsRuntime {
		const orchestrators = cost
			.filter((node) => node.selfCost === 0 && node.inclusiveCost > 0)
			.slice(0, 5)
			.map(ReportData.toSymbol);
		const hiddenHotspots = hottest
			.filter((hotspot) => (fanIn.get(hotspot.id) ?? 0) <= HIDDEN_HOTSPOT_MAX_CALLERS)
			.slice(0, 5)
			.map(ReportData.toSymbol);
		const alignedCore = hottest
			.filter((hotspot) => (fanIn.get(hotspot.id) ?? 0) > HIDDEN_HOTSPOT_MAX_CALLERS)
			.slice(0, 5)
			.map(ReportData.toSymbol);
		return { orchestrators, hiddenHotspots, alignedCore };
	}

	private static async readProvenance(store: KuzuStore): Promise<SourceManifest | null> {
		const raw = await store.readGraphMeta(SOURCE_MANIFEST_KEY);
		if (raw === null) {
			return null;
		}
		const parsed = SourceManifestSchema.safeParse(raw);
		return parsed.success === true ? parsed.data : null;
	}

	private static async readCommunityQuality(store: KuzuStore): Promise<number | null> {
		const raw = await store.readGraphMeta(CLUSTERING_MANIFEST_KEY);
		if (raw === null) {
			return null;
		}
		const quality = raw.quality;
		return typeof quality === 'number' ? quality : null;
	}

	/** Derives `owner/repo` from the recorded GitHub base URL, falling back to the given label. */
	private static projectName(provenance: SourceManifest | null, fallback: string): string {
		if (provenance === null) {
			return fallback;
		}
		try {
			const path = new URL(provenance.baseUrl).pathname.replace(/^\/+|\/+$/g, '');
			return path.length > 0 ? path : fallback;
		} catch {
			return fallback;
		}
	}

	private static verdictOf(data: GraphReportData): string {
		const shape = data.semantic === true ? (data.enriched === true ? 'semantic, enriched' : 'semantic') : 'structural';
		const cycles = data.totals.cycles === 0 ? 'acyclic' : `${data.totals.cycles} call cycle(s)`;
		const sentences = [`${data.totals.symbols} symbols across ${data.totals.files} files — ${shape}, ${cycles}.`];
		if (data.enriched === true && data.hotspots.length > 0) {
			const hottest = data.hotspots[0];
			const costNode = data.cost.find((node) => node.name === hottest.name && node.filePath === hottest.filePath);
			const share = costNode === undefined ? '' : ` (${(costNode.shareOfTotal * 100).toFixed(1)}% of inclusive cost)`;
			sentences.push(`\`${hottest.name}\` is the hottest function${share}.`);
		}
		if (data.totals.deadExports > 0) {
			sentences.push(`${data.totals.deadExports} exported symbol(s) appear dead.`);
		}
		return sentences.join(' ');
	}

	private static toRanked(ref: HotspotRef): RankedSymbol {
		return { name: ref.name, kind: ref.kind, filePath: ref.filePath, startLine: ref.startLine, score: ref.score };
	}

	private static toCostNode(ref: CostRef): ReportCostNode {
		return {
			name: ref.name,
			kind: ref.kind,
			filePath: ref.filePath,
			startLine: ref.startLine,
			selfCost: ref.selfCost,
			inclusiveCost: ref.inclusiveCost,
			shareOfTotal: ref.shareOfTotal,
			cyclic: ref.cyclic,
			cycleSize: ref.cycleSize,
		};
	}

	private static toSymbol(ref: SymbolRef): ReportSymbol {
		return { name: ref.name, kind: ref.kind, filePath: ref.filePath, startLine: ref.startLine };
	}
}
