import type { KuzuValue } from 'kuzu';
import { EDGE_KINDS, EdgeKind } from '../schema/edge.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { CommunityDetector, CommunityOptions, DEFAULT_COMMUNITY_OPTIONS, WeightedEdge } from './community_detector.js';

/** Namespaced key under which a node's community index is stored on its metadata. */
export const COMMUNITY_METADATA_KEY = 'community';

/** Graph-level metadata key under which the clustering manifest is recorded. */
export const CLUSTERING_MANIFEST_KEY = 'clustering';

/** The summary `cluster` returns and prints. */
export type ClusterReport = {
	nodesAssigned: number;
	communityCount: number;
	quality: number;
	resolution: number;
	/** Member count per community, descending. */
	sizes: number[];
};

/**
 * Orchestrates a clustering pass over a loaded graph: read the weighted edges,
 * detect communities with {@link CommunityDetector}, and attach the community
 * index onto each node's metadata. Mirrors {@link RuntimeEnricher} — the pure
 * algorithm lives in {@link CommunityDetector}; this class owns the store I/O.
 *
 * Existing node metadata is preserved; only the `community` key is written, so
 * re-running is idempotent for an unchanged graph.
 */
export class GraphClusterer {
	static async cluster(
		store: KuzuStore,
		weights: Partial<Record<EdgeKind, number>> = {},
		options: CommunityOptions = DEFAULT_COMMUNITY_OPTIONS,
	): Promise<ClusterReport> {
		const edges = await GraphClusterer.readWeightedEdges(store, weights);
		const result = CommunityDetector.detect(edges, options);

		const nodes = await store.readNodes();
		const updates = nodes
			.filter((node) => result.communityOf.has(node.id) === true)
			.map((node) => ({
				id: node.id,
				metadata: { ...node.metadata, [COMMUNITY_METADATA_KEY]: result.communityOf.get(node.id) },
			}));
		await store.writeNodeMetadata(updates);

		await store.writeGraphMeta(CLUSTERING_MANIFEST_KEY, {
			algorithm: 'leiden-cpm',
			resolution: options.resolution,
			communityCount: result.communityCount,
			quality: result.quality,
		});

		return {
			nodesAssigned: updates.length,
			communityCount: result.communityCount,
			quality: result.quality,
			resolution: options.resolution,
			sizes: result.sizes,
		};
	}

	/**
	 * Reads every edge whose kind carries a positive weight, resolving each to a
	 * {@link WeightedEdge} whose weight is the kind's coefficient times the edge's
	 * call-site `count`.
	 */
	private static async readWeightedEdges(
		store: KuzuStore,
		weights: Partial<Record<EdgeKind, number>>,
	): Promise<WeightedEdge[]> {
		const kinds = EDGE_KINDS.filter((kind) => (weights[kind] ?? 0) > 0);
		if (kinds.length === 0) {
			return [];
		}
		const kindList = `[${kinds.map((kind) => `'${kind}'`).join(', ')}]`;
		const rows = await store.run(
			`MATCH (source:GraphNode)-[e:Edge]->(target:GraphNode)
			WHERE e.kind IN ${kindList}
			RETURN source.id AS fromId, target.id AS toId, e.kind AS kind, e.metadata AS metadata`,
		);
		return rows.map((row) => {
			const kind = String(row.kind) as EdgeKind;
			const count = GraphClusterer.callCount(row.metadata);
			return {
				from: String(row.fromId),
				to: String(row.toId),
				weight: (weights[kind] ?? 0) * count,
			};
		});
	}

	/** Decodes an edge's call-site `count`, defaulting to 1 (the minimum the builder records). */
	private static callCount(value: KuzuValue): number {
		if (typeof value !== 'string' || value.length === 0) {
			return 1;
		}
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null) {
				const count = (parsed as Record<string, unknown>).count;
				return typeof count === 'number' && count > 0 ? count : 1;
			}
			return 1;
		} catch {
			return 1;
		}
	}
}
