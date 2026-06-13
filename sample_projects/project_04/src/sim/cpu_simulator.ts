import { QueueMath } from './queue_math.js';
import type { DimensionSimulator } from './dimension_simulator.js';
import type { Dimension, DimensionDemand, DimensionResult } from '../types/capacity.js';

/** Unloaded CPU service time per request, in milliseconds. */
const CPU_SERVICE_MS = 5;

/** Steady-state CPU model: PHP request processing competing for CPU-milliseconds. */
export class CpuSimulator implements DimensionSimulator {
	readonly dimension: Dimension = 'cpu';

	serviceTimeMs(): number {
		return CPU_SERVICE_MS;
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
