import { fetchTrafficBaseline } from '../clients/baseline_client.js';

/** Steady-state arrival rate (requests/second) per route, before any live scaling. */
export const DEFAULT_ARRIVAL_RATES: Record<string, number> = {
	'GET /products': 120,
	'GET /products/:id': 200,
	'POST /orders': 40,
	'GET /search': 90,
	'GET /health': 20,
};

/** Resolves the per-route arrival rates the simulator runs against. */
export class Workload {
	/** Scale the default arrival rates by a live traffic baseline (neutral factor 1 when offline). */
	static async resolve(): Promise<Record<string, number>> {
		const baseline = await fetchTrafficBaseline();
		return Workload.scale(DEFAULT_ARRIVAL_RATES, baseline.factor);
	}

	/** Multiply every route's arrival rate by a factor (factor 1 leaves the rates unchanged). */
	static scale(rates: Record<string, number>, factor: number): Record<string, number> {
		const scaled: Record<string, number> = {};
		for (const [route, rate] of Object.entries(rates)) {
			scaled[route] = rate * factor;
		}
		return scaled;
	}
}
