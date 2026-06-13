import { registerRoutes, ROUTE_PROFILES } from './endpoints/registry.js';
import { Simulator } from './sim/simulator.js';
import { Workload } from './workload/workload.js';
import { loadHardware } from './config/hardware.js';
import type { RouteHandler, Router } from './types/http.js';

/** A throwaway in-memory router so the sample runs without a real HTTP server. */
class MemoryRouter implements Router {
	readonly handlers = new Map<string, RouteHandler>();

	get(path: string, handler: RouteHandler): void {
		this.handlers.set(`GET ${path}`, handler);
	}

	post(path: string, handler: RouteHandler): void {
		this.handlers.set(`POST ${path}`, handler);
	}
}

/**
 * A tiny end-to-end example, runnable with `npm run dev` (or `npx tsx src/main.ts`).
 *
 * It also roots the call graph: `main` is *not* exported, so it registers the
 * simulated server's routes (the `HANDLES` leg) and runs the steady-state capacity
 * simulation (the `CALLS`/`INSTANTIATES` leg through `Simulator.run`).
 */
async function main(): Promise<void> {
	const router = new MemoryRouter();
	registerRoutes(router);

	const hardware = loadHardware();
	const arrivalRates = await Workload.resolve();
	const result = Simulator.run(ROUTE_PROFILES, arrivalRates, hardware);

	console.log(`endpoints=${router.handlers.size} offered=${result.totalArrivalRate} req/s`);
	console.log(`bottleneck=${result.bottleneck} servers=${result.totalServers}`);
	for (const dimension of result.perDimension) {
		console.log(
			`  ${dimension.dimension}: util=${dimension.utilization.toFixed(2)} ` +
				`latency=${dimension.latencyMs.toFixed(1)}ms servers=${dimension.serversNeeded}`,
		);
	}
}

main();
