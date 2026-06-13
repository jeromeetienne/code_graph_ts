import { QueueMath } from './queue_math.js';
import type { DimensionSimulator } from './dimension_simulator.js';
import type { Dimension, DimensionDemand, DimensionResult } from '../types/capacity.js';

/** Unloaded network service time per request, in milliseconds. */
const NETWORK_SERVICE_MS = 2;

/** Steady-state network model: request and response bytes competing for link bandwidth. */
export class NetworkSimulator implements DimensionSimulator {
	readonly dimension: Dimension = 'network';

	serviceTimeMs(): number {
		return NETWORK_SERVICE_MS;
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
