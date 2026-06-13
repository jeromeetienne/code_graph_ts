import type { Dimension, DimensionDemand, DimensionResult } from '../types/capacity.js';

/**
 * A per-dimension steady-state capacity model. Each hardware dimension (CPU,
 * network, disk) has one implementation; sharing this shape lets the orchestrator
 * treat them uniformly.
 */
export interface DimensionSimulator {
	/** Which dimension this simulator models. */
	readonly dimension: Dimension;
	/** Unloaded per-request service time on this dimension, in milliseconds. */
	serviceTimeMs(): number;
	/** Reduce aggregate demand against single-server capacity to a steady-state result. */
	evaluate(load: DimensionDemand): DimensionResult;
}
