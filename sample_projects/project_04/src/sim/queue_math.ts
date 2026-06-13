/** Latency reported once a dimension is at or beyond capacity: an unstable, unbounded queue. */
const QUEUE_BLOWUP_MS = 60_000;

/** Utilization is clamped just below 1 so the closed form never divides by zero or goes negative. */
const MAX_UTILIZATION = 0.999;

/**
 * M/M/1-style queueing latency: flat near the service time at low load, climbing
 * steeply as utilization approaches capacity, and pinned to a large finite penalty
 * once demand meets or exceeds one server's capacity.
 */
export class QueueMath {
	/** `serviceTime / (1 − utilization)`, with utilization clamped and an at-capacity blow-up. */
	static latencyMs(serviceTimeMs: number, utilization: number): number {
		if (utilization >= MAX_UTILIZATION) {
			return QUEUE_BLOWUP_MS;
		}
		const clamped = utilization < 0 ? 0 : utilization;
		return serviceTimeMs / (1 - clamped);
	}
}
