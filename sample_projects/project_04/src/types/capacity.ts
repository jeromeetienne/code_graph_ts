/** The three hardware resources a request consumes; the simulation has one simulator per value. */
export type Dimension = 'cpu' | 'network' | 'disk';

/**
 * What one request to a given endpoint costs, per dimension.
 *
 * Units:
 * - `cpu`: CPU-milliseconds of service time per request (`ms-CPU/req`)
 * - `network`: kilobytes transferred per request (`KB/req`)
 * - `disk`: disk I/O operations per request (`IOPS/req`)
 */
export type ResourceProfile = {
	cpu: number;
	network: number;
	disk: number;
};

/**
 * One server's capacity, per dimension, in units matched to `ResourceProfile × arrivalRate`:
 * - `cpu`: CPU-milliseconds available per wall-clock second (`ms-CPU/s`; 1000 ≈ one core)
 * - `network`: kilobytes per second (`KB/s`)
 * - `disk`: I/O operations per second (`IOPS`)
 */
export type Hardware = {
	cpu: number;
	network: number;
	disk: number;
};

/** One simulated endpoint: its route key and the per-request cost the simulator sums. */
export type RouteProfile = {
	route: string;
	profile: ResourceProfile;
};

/** Aggregate demand on one dimension, summed across every endpoint (same units as `Hardware`). */
export type DimensionDemand = {
	dimension: Dimension;
	demand: number;
	capacity: number;
};

/** The steady-state outcome for one dimension. */
export type DimensionResult = {
	dimension: Dimension;
	demand: number;
	capacity: number;
	utilization: number;
	latencyMs: number;
	serversNeeded: number;
	saturated: boolean;
};

/** The whole-system steady-state result: the per-dimension breakdown plus the binding constraint. */
export type SimulationResult = {
	perDimension: DimensionResult[];
	bottleneck: Dimension;
	totalServers: number;
	totalArrivalRate: number;
};
