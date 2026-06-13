import { Clustering, LeidenAlgorithm, Network } from 'networkanalysis-ts';

/** A directed graph edge reduced to its endpoints and a pre-resolved weight. */
export type WeightedEdge = {
	from: string;
	to: string;
	weight: number;
};

/** Tuning for a {@link CommunityDetector.detect} run. */
export type CommunityOptions = {
	/** CPM resolution: higher splits the graph into more, smaller communities. */
	resolution: number;
	/** Leiden iterations per random start; each iteration moves, refines, and re-aggregates. */
	iterations: number;
	/** Independent random starts; the partition with the best CPM quality wins. */
	randomStarts: number;
};

/** The outcome of a clustering run, keyed back to the caller's string node ids. */
export type CommunityResult = {
	/** Node id to community index. Nodes touched by no weighted edge are absent. */
	communityOf: Map<string, number>;
	/** Number of communities found. */
	communityCount: number;
	/** CPM quality of the chosen partition. */
	quality: number;
	/** Member count per community, descending. */
	sizes: number[];
};

/**
 * Defaults tuned for module-scale community detection. `resolution` is a
 * threshold on a community's average internal edge weight; 0.1 is permissive
 * enough to keep loosely-coupled modules together. Sweep it up (toward 1) for
 * tighter, finer clusters.
 */
export const DEFAULT_COMMUNITY_OPTIONS: CommunityOptions = {
	resolution: 0.1,
	iterations: 10,
	randomStarts: 10,
};

/**
 * Detects communities in the knowledge graph with the Leiden algorithm,
 * delegating the optimization to `networkanalysis-ts` (the CWTS port of the
 * library by the authors of the Leiden paper). The algorithm guarantees every
 * community it returns is internally connected — unlike Louvain, which can leave
 * a community split into disconnected pieces.
 *
 * This module is pure: it takes weighted edges and returns a partition, with no
 * store access, mirroring how {@link RuntimeJoin} is the pure core behind
 * `enrich`.
 */
export class CommunityDetector {
	/**
	 * Runs Leiden (CPM quality function) over a weighted, undirected projection of
	 * the supplied edges.
	 *
	 * Directed edges are symmetrized: every unordered endpoint pair sums its
	 * weights onto a single undirected edge, so a mutual call counts once with the
	 * combined weight. String node ids are mapped to the contiguous integer indices
	 * the `Network` requires, and the resulting community labels are mapped back.
	 */
	static detect(edges: WeightedEdge[], options: CommunityOptions = DEFAULT_COMMUNITY_OPTIONS): CommunityResult {
		const { ids, indexOf } = CommunityDetector.indexNodes(edges);
		if (ids.length === 0) {
			return { communityOf: new Map(), communityCount: 0, quality: 0, sizes: [] };
		}
		const undirected = CommunityDetector.symmetrize(edges, indexOf);

		// Uniform node weights (not degree) keep this classic CPM: the resolution is
		// then a portable threshold on a community's average internal edge weight,
		// independent of node degree. Degree weights make the usable resolution range
		// collapse to a graph-specific sliver.
		const network = new Network({
			nNodes: ids.length,
			setNodeWeightsToTotalEdgeWeights: false,
			edges: [undirected.sources, undirected.targets],
			edgeWeights: undirected.weights,
			sortedEdges: false,
			checkIntegrity: false,
		});

		const algorithm = new LeidenAlgorithm();
		algorithm.setResolution(options.resolution);
		algorithm.setNIterations(options.iterations);

		let best: Clustering | undefined;
		let bestQuality = Number.NEGATIVE_INFINITY;
		for (let start = 0; start < options.randomStarts; start += 1) {
			const clustering = new Clustering({ nNodes: network.getNNodes() });
			algorithm.improveClustering(network, clustering);
			const quality = algorithm.calcQuality(network, clustering);
			if (quality > bestQuality) {
				best = clustering;
				bestQuality = quality;
			}
		}
		if (best === undefined) {
			return { communityOf: new Map(), communityCount: 0, quality: 0, sizes: [] };
		}
		best.orderClustersByNNodes();

		const labels = best.getClusters();
		const communityOf = new Map<string, number>();
		ids.forEach((id, i) => communityOf.set(id, labels[i]));
		return {
			communityOf,
			communityCount: best.getNClusters(),
			quality: bestQuality,
			sizes: best.getNNodesPerCluster(),
		};
	}

	/** Assigns every node id touched by an edge a stable, contiguous integer index. */
	private static indexNodes(edges: WeightedEdge[]): { ids: string[]; indexOf: Map<string, number> } {
		const indexOf = new Map<string, number>();
		const ids: string[] = [];
		for (const edge of edges) {
			for (const id of [edge.from, edge.to]) {
				if (indexOf.has(id) === false) {
					indexOf.set(id, ids.length);
					ids.push(id);
				}
			}
		}
		return { ids, indexOf };
	}

	/** Collapses directed edges into undirected ones, summing weights per unordered pair and dropping self-loops. */
	private static symmetrize(
		edges: WeightedEdge[],
		indexOf: Map<string, number>,
	): { sources: number[]; targets: number[]; weights: number[] } {
		const merged = new Map<string, number>();
		for (const edge of edges) {
			const a = indexOf.get(edge.from);
			const b = indexOf.get(edge.to);
			if (a === undefined || b === undefined || a === b) {
				continue;
			}
			const low = a < b ? a : b;
			const high = a < b ? b : a;
			const key = `${low}:${high}`;
			merged.set(key, (merged.get(key) ?? 0) + edge.weight);
		}
		const sources: number[] = [];
		const targets: number[] = [];
		const weights: number[] = [];
		for (const [key, weight] of merged) {
			const separator = key.indexOf(':');
			sources.push(Number(key.slice(0, separator)));
			targets.push(Number(key.slice(separator + 1)));
			weights.push(weight);
		}
		return { sources, targets, weights };
	}
}
