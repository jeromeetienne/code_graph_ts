import { QueueMath } from './queue_math.js';
import type { DimensionSimulator } from './dimension_simulator.js';
import type { Dimension, DimensionDemand, DimensionResult } from '../types/capacity.js';

/** Unloaded disk service time per request, in milliseconds (a SQL/MySQL round trip). */
const DISK_SERVICE_MS = 8;

/** Steady-state disk model: the endpoint's SQL/MySQL I/O competing for disk operations. */
export class DiskSimulator implements DimensionSimulator {
	readonly dimension: Dimension = 'disk';

	serviceTimeMs(): number {
		return DISK_SERVICE_MS;
	}

	evaluate(load: DimensionDemand): DimensionResult {
		const utilization = load.demand / load.capacity;
		return {
			dimension: this.dimension,
			demand: load.demand,
			capacity: load.capacity,
			utilization,
			latencyMs: QueueMath.latencyMs(this.serviceTimeMs(), utilization),
			serversNeeded: Math.max(1, Math.ceil(utilization)),
			saturated: utilization >= 1,
		};
	}
}
