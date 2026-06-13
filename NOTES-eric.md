## Questions Eric would like to be answered
he got an actual service that is running in production and he would like to know if it can be optimised and 
how much it can be optimised. He also wants to know if the optimisations are worth it or not. 
He want to know if the current servers are enougth and up to how many customers he can handle with it.

- how many customer dash menu server can accept
- SQL Load
  - estimation load
  - potential bottlenecks
- ts_knowledge_graph by claude
  - detection of optimisation
  - creation of gh issue describing it
  - eric to actually do the cut/paste
- audit maintenability
  - usage fallow
- audit security
- mesure latence
- intrumentisation of the target codebase is sufficient
  - if not, create gh issue describing it
- https://dash-suite.com/
- https://www.vectron-systems.com/en/


## Notes on #37 and #38 (both CLOSED)

These two issues describe exactly the "fake server" idea above — a self-contained,
deterministic LAMP capacity simulation living in `sample_projects/project_04`. Together
they answer Eric's core questions (how many customers per server, where the bottleneck is,
how many servers are needed) without touching the real production service.

### #37 — server side: LAMP capacity simulation
Replaces the old `express-api` fixture with a small TypeScript model of a LAMP web server:

- **Two sides:** a resource config file (hardware capacity per dimension) and a simulated
  server exposing ~5 endpoints.
- **3 resource dimensions:** CPU (PHP processing), network (request + response bytes),
  disk (driven mainly by SQL/MySQL work). Each dimension is simulated independently and
  capped by the hardware's maximal capacity.
- **Latency is emergent, not an input:** it climbs as a dimension nears capacity (requests
  queue) and drops with faster/larger hardware.
- **Capacity & scaling:** when demand on a dimension exceeds one server's supply, provision
  another. Server count is driven by whichever dimension saturates first (the bottleneck).
- **Open questions:** exact latency curve (queueing knee vs. flat over-capacity penalty),
  units per dimension, steady-state vs. time-stepped, and what lives in config vs. code.

This directly maps to Eric's "fake server to test optimisations locally" and "how many
customers can one server accept / where are the bottlenecks".

### #38 — client side: load generator (companion to #37)
A deterministic, in-process load generator at `scripts/benchmarks/project_04_workload.ts`,
modeled on ApacheBench's *concepts* (no real sockets, no external tool):

- **Open-loop arrivals:** requests arrive at a target rate regardless of whether earlier
  ones finished, so latency can genuinely blow up under overload (a closed-loop `ab -c`
  model self-throttles and never truly overloads).
- **Ramp until it breaks:** increase the rate over time to find "the knee" — the exact point
  where one server stops coping.
- **Weighted request mix** across the ~5 endpoints (mostly cheap reads, occasional heavy
  SQL/report endpoint) for realistic, uneven per-dimension load.
- **Output = summary + capacity verdict:** throughput, latency p50/p95/p99, failures, plus
  per-dimension utilization, the bottleneck dimension, and the required server count.
- **Seeded & fully reproducible:** fixed seed → byte-identical runs, keeping the fixture
  deterministic and usable in the test/benchmark loop.
- **One scenario file** holds both hardware capacities and the workload definition (this
  resolves #37's config-boundary open question).

### How this serves Eric's questions
- "How many customers can one server accept" → the ramp's knee + bottleneck dimension.
- "Are the current servers enough / up to how many customers" → the required server count
  the verdict reports.
- "Test optimisations locally before production" → swap the scenario file or endpoint
  profiles and re-run deterministically, no real traffic needed.
- "SQL load / bottlenecks" → disk dimension is driven mainly by MySQL work, and the verdict
  names which dimension saturates first.
