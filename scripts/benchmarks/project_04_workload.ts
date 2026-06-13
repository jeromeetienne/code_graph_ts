// Companion to issue #38: the *client* side of the project_04 LAMP capacity
// simulation. An in-process, deterministic, open-loop load generator modeled on
// ApacheBench's concepts (not the binary): no real socket, no external tool.
//
// Unlike the other scripts/benchmarks/project_NN_workload.ts files — which drive a
// sample's real functions so the V8 profiler can measure CPU self-time — this one
// feeds *simulated* requests (with declared CPU/disk/network costs) into the
// *modeled* server from sample_projects/project_04 and computes latency/utilization
// analytically. It ramps the offered rate through a weighted endpoint mix until a
// dimension saturates (the knee), then reports throughput, latency percentiles,
// failures, the bottleneck dimension, and the server count the load would require.
//
// Determinism: a seeded RNG makes a fixed seed produce byte-identical runs, so the
// generator is usable in the test loop. It lives outside the extracted source root,
// so it never becomes a graph node.
//
// Run it:  npm run project04:workload   (or)  npx tsx scripts/benchmarks/project_04_workload.ts
import { pathToFileURL } from 'node:url';
import {
	Simulator,
	QueueMath,
	ROUTE_PROFILES,
} from '../../sample_projects/project_04/src/index.js';
import type {
	Dimension,
	Hardware,
	ResourceProfile,
	SimulationResult,
} from '../../sample_projects/project_04/src/index.js';

/** A request whose modeled latency exceeds this client-side timeout counts as a failure. */
const TIMEOUT_MS = 10_000;

/** Once a dimension saturates, run this many further overload steps to capture the failure tail. */
const EXTRA_OVERLOAD_STEPS = 2;

/** Per-request service time of one disk I/O operation, in milliseconds (≈ an SSD random access). */
const MS_PER_IOP = 0.125;

/** Per-request service time of one transferred kilobyte, in milliseconds (≈ a 1 Gbit/s link). */
const MS_PER_KB = 0.008;

/** How the offered rate climbs over time: equal-duration (1 s) steps of `stepRps` more each. */
type Ramp = {
	startRps: number;
	stepRps: number;
	maxSteps: number;
};

/** One weighted entry of the request mix: a route key and its relative share of arrivals. */
type MixEntry = {
	route: string;
	weight: number;
};

/** A single source of truth for one load-test run: the hardware under test plus the workload. */
type Scenario = {
	hardware: Hardware;
	mix: MixEntry[];
	ramp: Ramp;
	seed: number;
};

/** The capacity verdict for one scenario: ApacheBench-style stats plus the provisioning answer. */
type Report = {
	offeredRequests: number;
	completedRequests: number;
	failedRequests: number;
	throughputRps: number;
	latencyP50: number;
	latencyP95: number;
	latencyP99: number;
	knee: { rps: number; dimension: Dimension } | null;
	peakRps: number;
	peak: SimulationResult;
};

/**
 * The default scenario: the same single-server hardware the server model defaults to, a
 * read-heavy mix with an occasional heavy search, ramped until it breaks.
 */
export const DEFAULT_SCENARIO: Scenario = {
	hardware: { cpu: 4000, network: 125000, disk: 8000 },
	mix: [
		{ route: 'GET /products/:id', weight: 50 },
		{ route: 'GET /products', weight: 25 },
		{ route: 'GET /search', weight: 10 },
		{ route: 'POST /orders', weight: 10 },
		{ route: 'GET /health', weight: 5 },
	],
	ramp: { startRps: 50, stepRps: 50, maxSteps: 60 },
	seed: 12345,
};

/** A small, fast, fully deterministic PRNG (mulberry32): same seed → same sequence. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Pick a route from the weighted mix given a random sample in [0, 1). */
function pickRoute(mix: MixEntry[], totalWeight: number, sample: number): string {
	let cursor = sample * totalWeight;
	for (const entry of mix) {
		cursor -= entry.weight;
		if (cursor < 0) {
			return entry.route;
		}
	}
	return mix[mix.length - 1].route;
}

/** The unloaded service time of one request, summed across the dimensions it touches (ms). */
function baseServiceMs(profile: ResourceProfile): number {
	return profile.cpu + profile.disk * MS_PER_IOP + profile.network * MS_PER_KB;
}

/** Return the p-th percentile of an ascending-sorted array (nearest-rank), or 0 when empty. */
function percentile(sortedAscending: number[], p: number): number {
	if (sortedAscending.length === 0) {
		return 0;
	}
	const rank = Math.ceil((p / 100) * sortedAscending.length);
	const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
	return sortedAscending[index];
}

/**
 * Run one scenario to a capacity verdict. Pure and deterministic: it only reads the
 * scenario and the seeded RNG, so the same scenario always yields the same report.
 */
export function runScenario(scenario: Scenario): Report {
	const random = mulberry32(scenario.seed);
	const totalWeight = scenario.mix.reduce((sum, entry) => sum + entry.weight, 0);
	const profileByRoute = new Map<string, ResourceProfile>(
		ROUTE_PROFILES.map((endpoint): [string, ResourceProfile] => [endpoint.route, endpoint.profile]),
	);

	const latencies: number[] = [];
	let offeredRequests = 0;
	let failedRequests = 0;
	let knee: { rps: number; dimension: Dimension } | null = null;
	let peak: SimulationResult | null = null;
	let peakRps = 0;
	let stepsRun = 0;
	let overloadStepsRun = 0;

	for (let step = 0; step < scenario.ramp.maxSteps; step += 1) {
		const rps = scenario.ramp.startRps + step * scenario.ramp.stepRps;
		const arrivalsPerRoute: Record<string, number> = {};
		for (let arrival = 0; arrival < rps; arrival += 1) {
			const route = pickRoute(scenario.mix, totalWeight, random());
			arrivalsPerRoute[route] = (arrivalsPerRoute[route] ?? 0) + 1;
		}

		const result = Simulator.run(ROUTE_PROFILES, arrivalsPerRoute, scenario.hardware);
		const maxUtilization = Math.max(...result.perDimension.map((entry) => entry.utilization));

		for (const [route, count] of Object.entries(arrivalsPerRoute)) {
			const profile = profileByRoute.get(route);
			if (profile === undefined) {
				continue;
			}
			const latency = QueueMath.latencyMs(baseServiceMs(profile), maxUtilization);
			for (let i = 0; i < count; i += 1) {
				offeredRequests += 1;
				if (latency > TIMEOUT_MS) {
					failedRequests += 1;
				} else {
					latencies.push(latency);
				}
			}
		}

		peak = result;
		peakRps = rps;
		stepsRun += 1;

		if (knee === null && result.perDimension.some((entry) => entry.saturated)) {
			knee = { rps, dimension: result.bottleneck };
		}
		if (knee !== null) {
			overloadStepsRun += 1;
			if (overloadStepsRun > EXTRA_OVERLOAD_STEPS) {
				break;
			}
		}
	}

	if (peak === null) {
		throw new Error('scenario produced no steps; check ramp.maxSteps');
	}

	latencies.sort((a, b) => a - b);
	return {
		offeredRequests,
		completedRequests: latencies.length,
		failedRequests,
		throughputRps: latencies.length / stepsRun,
		latencyP50: percentile(latencies, 50),
		latencyP95: percentile(latencies, 95),
		latencyP99: percentile(latencies, 99),
		knee,
		peakRps,
		peak,
	};
}

/** Render a report as a human-readable ApacheBench-style block. */
export function formatReport(scenario: Scenario, report: Report): string {
	const lines: string[] = [];
	lines.push(`LAMP capacity load test (seed=${scenario.seed})`);
	lines.push(
		`  ramp:        ${scenario.ramp.startRps} → ${report.peakRps} req/s ` +
			`(+${scenario.ramp.stepRps}/step)`,
	);
	lines.push(`  offered:     ${report.offeredRequests} requests`);
	lines.push(`  completed:   ${report.completedRequests}`);
	const failPct = report.offeredRequests === 0 ? 0 : (report.failedRequests / report.offeredRequests) * 100;
	lines.push(`  failed:      ${report.failedRequests} (${failPct.toFixed(1)}%)`);
	lines.push(`  throughput:  ${report.throughputRps.toFixed(1)} req/s (mean completed)`);
	lines.push(
		`  latency:     p50=${report.latencyP50.toFixed(1)}ms ` +
			`p95=${report.latencyP95.toFixed(1)}ms p99=${report.latencyP99.toFixed(1)}ms`,
	);
	lines.push(
		report.knee === null
			? '  knee:        not reached within the ramp'
			: `  knee:        saturates at ${report.knee.rps} req/s on ${report.knee.dimension}`,
	);
	lines.push(`  verdict @ peak ${report.peakRps} req/s:`);
	lines.push(`    bottleneck:     ${report.peak.bottleneck}`);
	lines.push(`    servers needed: ${report.peak.totalServers}`);
	for (const dimension of report.peak.perDimension) {
		lines.push(`    ${dimension.dimension}: util=${dimension.utilization.toFixed(2)}`);
	}
	return lines.join('\n');
}

/** Run the default scenario and print its verdict. */
function main(): void {
	console.log(formatReport(DEFAULT_SCENARIO, runScenario(DEFAULT_SCENARIO)));
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly === true) {
	main();
}
