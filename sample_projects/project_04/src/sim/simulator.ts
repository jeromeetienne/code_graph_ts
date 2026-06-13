import { CpuSimulator } from './cpu_simulator.js';
import { NetworkSimulator } from './network_simulator.js';
import { DiskSimulator } from './disk_simulator.js';
import type { DimensionSimulator } from './dimension_simulator.js';
import type {
	Dimension,
	DimensionResult,
	RouteProfile,
	Hardware,
	SimulationResult,
} from '../types/capacity.js';

/** Orchestrates the three per-dimension simulators into one steady-state capacity verdict. */
export class Simulator {
	/** Instantiate the per-dimension simulators, one per hardware dimension. */
	static build(): DimensionSimulator[] {
		return [new CpuSimulator(), new NetworkSimulator(), new DiskSimulator()];
	}

	/**
	 * One steady-state pass: sum per-dimension demand across endpoints, evaluate each
	 * dimension against single-server capacity, and report the bottleneck and fleet size.
	 */
	static run(
		profiles: RouteProfile[],
		arrivalRates: Record<string, number>,
		hardware: Hardware,
	): SimulationResult {
		const perDimension = Simulator.build().map((simulator) =>
			simulator.evaluate({
				dimension: simulator.dimension,
				demand: Simulator.demandFor(simulator.dimension, profiles, arrivalRates),
				capacity: hardware[simulator.dimension],
			}),
		);
		return {
			perDimension,
			bottleneck: Simulator.bottleneckOf(perDimension),
			totalServers: perDimension.reduce((max, result) => Math.max(max, result.serversNeeded), 1),
			totalArrivalRate: Object.values(arrivalRates).reduce((sum, rate) => sum + rate, 0),
		};
	}

	/** Sum one dimension's demand across endpoints: Σ arrivalRate × per-request cost. */
	private static demandFor(
		dimension: Dimension,
		profiles: RouteProfile[],
		arrivalRates: Record<string, number>,
	): number {
		return profiles.reduce((sum, endpoint) => {
			const rate = arrivalRates[endpoint.route] ?? 0;
			return sum + rate * endpoint.profile[dimension];
		}, 0);
	}

	/** The dimension with the highest single-server utilization — the binding constraint. */
	private static bottleneckOf(results: DimensionResult[]): Dimension {
		return results.reduce((worst, result) =>
			result.utilization > worst.utilization ? result : worst,
		).dimension;
	}
}
