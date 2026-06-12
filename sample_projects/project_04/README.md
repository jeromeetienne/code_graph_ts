# project_04 — `express-api`

A small HTTP API: a router with a handful of named route handlers, a couple of
environment-driven config values, and one outbound call to an external service.
It is the sample that exercises the **system-level layer** of
[`ts-knowledge-graph`](../../README.md) — the kinds that go beyond code symbols to
describe *how the system is wired*:

- **`Endpoint` + `HANDLES`** — route registrations (`router.get('/users', …)`)
  become `Endpoint` nodes, each with a `HANDLES` edge to the handler function.
- **`ConfigFlag` + `READS_CONFIG`** — `process.env.X` reads become `ConfigFlag`
  nodes, with a `READS_CONFIG` edge from the declaration that reads them.
- **`ExternalAPI` + `CALLS_EXTERNAL`** — `fetch(...)` call sites become
  `ExternalAPI` nodes (one per host), with a `CALLS_EXTERNAL` edge from the caller.

## What it contains

| File | Exports | Role |
| --- | --- | --- |
| `src/app.ts` | `createApp`, `main` | builds the app; mounts the routes and one inline `GET /ping` |
| `src/index.ts` | — | public barrel |
| `src/routes/routes.ts` | `registerRoutes` | registers `GET`/`POST /users` and `GET /health` with named handlers |
| `src/handlers/users.ts` | `listUsers`, `createUser` | route handlers; `listUsers` calls the GitHub client |
| `src/handlers/health.ts` | `health` | readiness handler; reads the configured `PORT` |
| `src/clients/github.ts` | `fetchRepos` | `fetch('https://api.github.com/users')` → an `ExternalAPI` |
| `src/config/config.ts` | `PORT`, `GITHUB_TOKEN` | `process.env` reads → `ConfigFlag` nodes |
| `src/types/types.ts` | `Request`, `Response`, `RouteHandler`, `Router` | minimal Express-style types |

It yields **4 `Endpoint` nodes** (`GET /users`, `POST /users`, `GET /health`, and
the inline `GET /ping`), **3 `HANDLES` edges** (the inline `/ping` has no named
handler to point at), **2 `ConfigFlag` nodes** (`PORT`, `GITHUB_TOKEN`), and **1
`ExternalAPI` node** (`api.github.com`) — alongside the usual `CALLS`, `READS`, and
type edges.

## Exercising it with ts-knowledge-graph

The system-level kinds appear only with `--semantic` (resolving each route's
handler needs symbol resolution):

```bash
# from the ts_knowledge_graph repo root
npm run project04:rebuild           # extract --semantic + load

npm run project04:find -- Endpoint  # all four routes (find matches by kind)
npm run project04:find -- /users    # GET /users, POST /users (or by name substring)

# who handles a route?  (HANDLES → handler)
npm run project04:neighbors -- 'Endpoint:GET /users'      # → listUsers
# what does a handler serve?  (references → the endpoint, via HANDLES)
npm run project04:references -- '<listUsers id from find>'

# the config surface and the outbound-HTTP surface
npm run project04:find -- ConfigFlag        # PORT, GITHUB_TOKEN
npm run project04:neighbors -- 'Config:PORT'             # → health, main (READS_CONFIG)
npm run project04:neighbors -- 'Api:api.github.com'      # → fetchRepos (CALLS_EXTERNAL)
```

Or run the whole walk-through at once:

```bash
npm run project04:tour
```
