# project_04 — `lamp-capacity`

A small **LAMP server capacity simulation**. It models a LAMP-style web server
that exposes ~5 endpoints, works out how much **CPU, network, and disk** a given
request workload demands, derives the resulting **latency** as each resource fills
up, and computes **how many servers** the workload needs once one server's hardware
is exceeded.

It is the sample that exercises the **system-level layer** of
[`ts-knowledge-graph`](../../README.md) — the kinds that go beyond code symbols to
describe *how the system is wired* — and, because the simulation has a real shape
of its own, it now also exercises the **type** and **behavioral** layers:

- **`Endpoint` + `HANDLES`** — the server's route registrations
  (`router.get('/products', listProducts)`) become `Endpoint` nodes, each with a
  `HANDLES` edge to its handler.
- **`ConfigFlag` + `READS_CONFIG`** — the per-dimension hardware caps are read from
  `process.env` (`MAX_CPU_MILLIS`, `MAX_NETWORK_KBPS`, `MAX_DISK_IOPS`), so each
  becomes a `ConfigFlag` node.
- **`ExternalAPI` + `CALLS_EXTERNAL`** — the workload's traffic-baseline
  `fetch('https://metrics.internal.example.com/…')` becomes an `ExternalAPI` node.
- **type layer** — three per-dimension simulators (`CpuSimulator`,
  `NetworkSimulator`, `DiskSimulator`) share one `DimensionSimulator` interface
  (`IMPLEMENTS`), and the result types ride `RETURNS` / `USES_TYPE` edges.
- **behavioral layer** — a non-exported `main()` roots the call graph through
  `Simulator.run`, which `INSTANTIATES` the three simulators and `CALLS` the shared
  `QueueMath`.

## The model

- **Steady state.** Given a per-endpoint arrival rate and one server's hardware
  caps, `Simulator.run` computes, in a single pass, each dimension's demand,
  utilization, latency, and the servers it needs.
- **Demand.** For each dimension, `demand = Σ arrivalRate × per-request cost`
  across the endpoints; `utilization = demand / capacity`.
- **Latency is emergent.** `QueueMath` uses an M/M/1-style curve —
  `latency = serviceTime / (1 − utilization)` — flat at low load, climbing steeply
  toward the knee, and pinned to a large finite penalty at/above capacity.
- **Scaling.** `serversNeeded = ⌈demand / capacity⌉` per dimension; the **bottleneck**
  is the dimension with the highest utilization and sets the total server count.

With the defaults (hardware `cpu 4000` ms-CPU/s, `network 125000` KB/s, `disk 8000`
IOPS; the workload in `src/workload/workload.ts`) the offered load is
**CPU-bottlenecked and needs 2 servers** — `GET /search` dominates the CPU demand.

## What it contains

| File | Exports | Role |
| --- | --- | --- |
| `src/main.ts` | `main` (not exported) | runs the example and roots the call graph: registers the routes **and** runs the simulation |
| `src/index.ts` | — | public barrel |
| `src/types/http.ts` | `Request`, `Response`, `RouteHandler`, `Router` | minimal Express-style types (no real dependency) |
| `src/types/capacity.ts` | `Dimension`, `ResourceProfile`, `Hardware`, `RouteProfile`, `DimensionDemand`, `DimensionResult`, `SimulationResult` | the simulation's domain types |
| `src/config/hardware.ts` | `MAX_CPU_MILLIS`, `MAX_NETWORK_KBPS`, `MAX_DISK_IOPS`, `loadHardware` | `process.env` hardware caps → `ConfigFlag` nodes |
| `src/sim/dimension_simulator.ts` | `DimensionSimulator` | the per-dimension contract the three simulators implement |
| `src/sim/queue_math.ts` | `QueueMath` | the M/M/1-style latency formula |
| `src/sim/cpu_simulator.ts` | `CpuSimulator` | CPU dimension (`implements DimensionSimulator`) |
| `src/sim/network_simulator.ts` | `NetworkSimulator` | network dimension |
| `src/sim/disk_simulator.ts` | `DiskSimulator` | disk dimension (SQL/MySQL I/O) |
| `src/sim/simulator.ts` | `Simulator` | one-pass orchestrator; sums demand, picks the bottleneck |
| `src/endpoints/products.ts` | `listProducts`, `getProduct`, `PRODUCTS_PROFILE`, `PRODUCT_PROFILE` | route handlers + their resource profiles |
| `src/endpoints/orders.ts` | `createOrder`, `ORDERS_PROFILE` | balanced write handler |
| `src/endpoints/search.ts` | `searchProducts`, `SEARCH_PROFILE` | CPU-heavy search handler |
| `src/endpoints/health.ts` | `health`, `HEALTH_PROFILE` | trivial readiness handler |
| `src/endpoints/registry.ts` | `registerRoutes`, `ROUTE_PROFILES` | registers the 5 routes; the profiles the simulator sums |
| `src/workload/workload.ts` | `Workload`, `DEFAULT_ARRIVAL_RATES` | per-endpoint arrival rates; merges the live baseline |
| `src/clients/baseline_client.ts` | `fetchTrafficBaseline`, `TrafficBaseline` | `fetch(…)` a live baseline → an `ExternalAPI` |

It yields **5 `Endpoint` nodes** (`GET /products`, `GET /products/:id`,
`POST /orders`, `GET /search`, `GET /health`), **5 `HANDLES` edges** (every route
has a named handler), **3 `ConfigFlag` nodes** (`MAX_CPU_MILLIS`,
`MAX_NETWORK_KBPS`, `MAX_DISK_IOPS`), and **1 `ExternalAPI` node**
(`metrics.internal.example.com`) — alongside the `DimensionSimulator` interface
with its **3 `IMPLEMENTS`** edges and the usual `CALLS` / `INSTANTIATES` /
`RETURNS` / `READS` edges of the simulation core.

## The load generator (companion to [#38](https://github.com/jeromeetienne/ts_knowledge_graph/issues/38))

`scripts/benchmarks/project_04_workload.ts` is the **client** side: an in-process,
deterministic, **open-loop** load generator modeled on ApacheBench's concepts (no
real socket, no external tool). It ramps the offered rate through a weighted
endpoint mix until a dimension saturates — the **knee** — then prints an
ApacheBench-style verdict: throughput, latency p50/p95/p99, failures, the
bottleneck dimension, and the servers the load would require. A seeded RNG makes
each run **byte-identical**. It lives outside the extracted source root, so it
never becomes a graph node, and it reuses the server model's `Simulator`,
`QueueMath`, and types.

```bash
npm run project04:workload
```

## Exercising it with ts-knowledge-graph

The system-level kinds (and the endpoint→handler resolution) need `--semantic`,
which `project04:extract` already passes.

```bash
# from the ts_knowledge_graph repo root
npm run project04:rebuild            # extract --semantic + load

npm run project04:find -- Endpoint   # the five routes (find matches by kind)
npm run project04:find -- ConfigFlag # MAX_CPU_MILLIS, MAX_NETWORK_KBPS, MAX_DISK_IOPS
npm run project04:find -- ExternalAPI

# who handles a route?  (HANDLES → handler)
npm run project04:neighbors -- 'Endpoint:GET /search'        # → searchProducts
# who reads a hardware cap?  (READS_CONFIG)
npm run project04:neighbors -- 'Config:MAX_CPU_MILLIS'
# who calls out, and to where?  (CALLS_EXTERNAL)
npm run project04:neighbors -- 'Api:metrics.internal.example.com'   # → fetchTrafficBaseline

# the shared shape: who implements the per-dimension contract?  (IMPLEMENTS)
npm run project04:references -- '<DimensionSimulator id from find>'  # → Cpu/Network/DiskSimulator
```

Unlike the old `express-api` fixture, this project ships **tests**, so
`project04:verify` is now a full **type-check + test** pass (not type-check-only),
and the simulation has a real CPU hot path, so `project04:enrich` →
`project04:hotspots` / `project04:cost` attach and rank measured runtime.

Or run the whole walk-through at once — system-level, type, behavioral, enrich, and
the load-generator verdict:

```bash
npm run project04:tour
```
