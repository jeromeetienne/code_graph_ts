import { EdgeKind } from '../schema/edge.js';

/**
 * How strongly each edge kind pulls its two endpoints into the same community.
 * The effective weight of an edge is this coefficient times the edge's
 * `metadata.count` (how many times the relationship occurs in source).
 *
 * `IMPORTS` and `EXPORTS` are deliberately absent: they are module wiring, not
 * coupling, the same reasoning {@link REFERENCE_EDGE_KINDS} uses. `CONTAINS`
 * carries a low weight so same-file symbols lean together without overwhelming
 * call structure; drop it for modules that may cross files freely. System-level
 * kinds (`READS_CONFIG`, `CALLS_EXTERNAL`, `HANDLES`) are absent because their
 * targets are synthesized nodes, not code symbols.
 */
export const CLUSTER_EDGE_WEIGHTS: Partial<Record<EdgeKind, number>> = {
	CALLS: 3,
	INSTANTIATES: 2,
	EXTENDS: 2,
	IMPLEMENTS: 2,
	OVERRIDES: 1.5,
	WRITES: 1.5,
	READS: 1,
	USES_TYPE: 1,
	RETURNS: 1,
	PARAM_TYPE: 1,
	CONTAINS: 0.5,
};
