# open_ts_optim_ai

Parse TypeScript source code into a **knowledge graph**, then use that graph as
the substrate for an autonomous AI agent that finds and applies code
optimizations.

## Why a graph

An optimization agent constantly needs to reason about *blast radius*:

- *If I rewrite this function, who calls it and what breaks?* — `CALLS` edges
- *Is this export dead code I can delete?* — cross-file reference resolution
- *What is affected if I change this type?* — `USES_TYPE` / type-checker edges

These questions require **semantic** parsing (symbol + type resolution), which is
why the extractor is built on [`ts-morph`](https://ts-morph.com) (the TypeScript
Compiler API) rather than a syntax-only parser.

## Graph model

**Nodes** — `Module`, `Class`, `Interface`, `TypeAlias`, `Enum`, `Function`,
`Method`, `Property`, `Parameter`, `Variable`, `ExternalModule`.

**Edges**

| Layer | Edges |
| --- | --- |
| Structural | `CONTAINS`, `IMPORTS`, `EXPORTS` |
| Type | `EXTENDS`, `IMPLEMENTS`, `USES_TYPE`, `RETURNS`, `PARAM_TYPE` |
| Behavioral | `CALLS`, `INSTANTIATES`, `OVERRIDES`, `READS`, `WRITES` |

The structural layer is cheap and always emitted. The type + behavioral layers
require symbol resolution and are emitted with `--semantic`.

## Usage

```bash
npm install

# structural graph only (fast)
npm run extract -- <path-to-project> --out ./graph

# full graph with heritage + CALLS edges
npm run extract -- <path-to-project> --out ./graph --semantic
```

Output is two JSONL files — `graph/nodes.jsonl` and `graph/edges.jsonl` — one
record per line, easy to inspect, diff, and load into any store.

### Querying the graph

Load the JSONL into an embedded [Kùzu](https://kuzudb.com) database, then run the
query tools:

```bash
npm run dev -- load ./graph --db ./graph.kuzu

npm run dev -- find <name>                 # resolve a name to node ids
npm run dev -- who-calls <id>              # direct callers of a symbol
npm run dev -- calls <id>                  # what a symbol calls
npm run dev -- blast-radius <id> --depth 10  # transitive callers (impact set)
npm run dev -- dead-exports                # exported symbols with no inbound refs
npm run dev -- neighbors <id>              # one-hop neighbourhood (in + out)
```

Every query command accepts `--json` to emit machine-readable output — this is
the shape the optimization agent consumes. Node ids come from `find` or another
query's results; do not hand-write them.

The query methods on `GraphQuery` (`whoCalls`, `blastRadius`, `deadExports`,
`neighborhood`, …) are designed to map one-to-one onto agent tools: JSON in,
JSON out.

> **Known limitation (v1):** `dead-exports` over-reports. It only counts direct
> inbound `CALLS`/`EXTENDS`/`IMPLEMENTS`/`USES_TYPE` edges to a node, so a class
> whose *methods* are used still looks dead, and types look dead until
> `USES_TYPE` edges exist. Both are resolved by the type-edge phase plus
> member-aware reference counting.

## Architecture

```
src/
  schema/        Zod schemas for nodes and edges (the wire format)
  extract/
    project-loader.ts        load a ts-morph Project from tsconfig
    node-id.ts               deterministic, position-stable node ids
    structural-extractor.ts  modules, declarations, imports, containment
    semantic-extractor.ts    heritage (EXTENDS/IMPLEMENTS) + CALLS
    graph-builder.ts         orchestrates extraction, dedupes by id
  store/
    jsonl-store.ts           serialize the graph to JSONL
    jsonl-reader.ts          read + Zod-validate the JSONL back in
    kuzu-store.ts            load the graph into embedded Kùzu, run Cypher
  query/
    graph-query.ts           the agent's query tools (who-calls, blast-radius…)
  cli.ts                     extract / load / query commands
```

Node ids are derived purely from the declaration (`kind:relPath#name@line`), so
any extractor computes the same id for the same symbol without a shared
registry — that is what lets the semantic layer link a call site to the exact
declaration node the structural layer emitted.

## Roadmap

- [x] **Embedded query layer** — load into [Kùzu](https://kuzudb.com) (embedded,
  Cypher) with traversal tools: `who-calls`, `calls`, `blast-radius`,
  `dead-exports`, `neighbors`, `find`.
- [ ] **Type edges** — `USES_TYPE`, `RETURNS`, `PARAM_TYPE` from the type checker
  (also fixes `dead-exports` over-reporting).
- [ ] **Member-aware reference counting** — treat a class/module as live when any
  contained member is referenced.
- [ ] **Vector index** — embed per-node summaries for hybrid graph + semantic
  retrieval.
- [ ] **Optimization agent** — wire the `GraphQuery` tools to an agent loop that
  proposes edits and verifies them (`tsc` + tests) before keeping them.
