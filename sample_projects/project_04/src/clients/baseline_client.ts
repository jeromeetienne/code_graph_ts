/** A live traffic baseline: a multiplier applied to the default per-route arrival rates. */
export type TrafficBaseline = {
	factor: number;
};

/**
 * Fetches a current traffic multiplier from the monitoring service, falling back
 * to a neutral baseline when the service is unreachable. The static URL makes the
 * host an `ExternalAPI` node with a `CALLS_EXTERNAL` edge from this function.
 */
export async function fetchTrafficBaseline(): Promise<TrafficBaseline> {
	try {
		const response = await fetch('https://metrics.internal.example.com/v1/baseline');
		const body = (await response.json()) as { factor?: number };
		return { factor: typeof body.factor === 'number' ? body.factor : 1 };
	} catch {
		return { factor: 1 };
	}
}
