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
npm run extract -- <path-to-project>

# full graph with heritage + CALLS edges
npm run extract -- <path-to-project> --semantic
```

Output is two JSONL files — `outputs/graph/nodes.jsonl` and
`outputs/graph/edges.jsonl` (override with `--out`) — one record per line, easy
to inspect, diff, and load into any store.

### Querying the graph

Load the JSONL into an embedded [Kùzu](https://kuzudb.com) database, then run the
query tools:

```bash
npm run dev -- load        # reads ./outputs/graph, writes ./outputs/graph.kuzu

npm run dev -- find <name>                 # resolve a name to node ids
npm run dev -- who-calls <id>              # direct callers of a symbol
npm run dev -- calls <id>                  # what a symbol calls
npm run dev -- blast-radius <id> --depth 10  # transitive callers (impact set)
npm run dev -- references <id>             # everything that references a symbol/type
npm run dev -- dead-exports                # exported symbols with no inbound refs
npm run dev -- neighbors <id>              # one-hop neighbourhood (in + out)
```

Every query command accepts `--json` to emit machine-readable output — this is
the shape the optimization agent consumes. Node ids come from `find` or another
query's results; do not hand-write them.

The query methods on `GraphQuery` (`whoCalls`, `blastRadius`, `deadExports`,
`neighborhood`, …) are designed to map one-to-one onto agent tools: JSON in,
JSON out.

> **`dead-exports` accuracy:** it is member-aware (a class/interface counts as
> live when any contained member is referenced) and considers `CALLS`,
> `EXTENDS`, `IMPLEMENTS`, `USES_TYPE`, `RETURNS`, `PARAM_TYPE`, `INSTANTIATES`,
> and `READS` (value-identifier) edges. On this repository it reports exactly the
> two genuinely-unused type aliases — no false positives.

### The optimization agent

The end goal: an agent that uses the graph to find and apply optimizations,
verifying each one before keeping it.

```bash
cp .env-sample .env                 # pick a provider block, set key + model
npm run dev -- optimize --db ./outputs/graph.kuzu
npm run dev -- optimize "Inline the single-use helper X" --db ./outputs/graph.kuzu --model gpt-5.1
```

The LLM layer sits on the **OpenAI-compatible chat-completions API**, so any
provider exposing that surface works — OpenAI, OpenRouter, Ollama, LM Studio,
vLLM — configured entirely through `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and
`OPENAI_MODEL` (see [.env-sample](.env-sample)).

The agent runs a tool-calling loop. Its tools are the read-only `GraphQuery`
methods plus `read_file`; it gathers context, confirms blast radius, then calls
`propose_optimization`. The harness **applies the edit, runs `tsc --noEmit`,
and keeps it only if type-checking passes** — otherwise it reverts and hands
the compiler errors back for another attempt. Edits are unique-match
find/replace with in-memory backups; run on a clean git tree so you can review
(and `git checkout`) what it kept.

## Architecture

```
src/
  schema/        Zod schemas for nodes and edges (the wire format)
  extract/
    project_loader.ts        load a ts-morph Project from tsconfig
    node_id.ts               deterministic, position-stable node ids
    structural_extractor.ts  modules, declarations, imports, containment
    semantic_extractor.ts    heritage, CALLS, INSTANTIATES, type edges
    graph_builder.ts         orchestrates extraction, dedupes by id
  store/
    jsonl_store.ts           serialize the graph to JSONL
    jsonl_reader.ts          read + Zod-validate the JSONL back in
    kuzu_store.ts            load the graph into embedded Kùzu, run Cypher
  query/
    graph_query.ts           the agent's query tools (who-calls, blast-radius…)
  agent/
    agent_tools.ts           graph queries + read_file + propose_optimization, as LLM tools
    code_editor.ts           unique-match find/replace with in-memory backup + revert
    verifier.ts              runs `tsc --noEmit`, returns pass/fail + output
    optimizer_agent.ts       the LLM tool-calling loop (propose → verify → keep/revert)
  cli.ts                     extract / load / query / optimize commands
```

Node ids are derived purely from the declaration (`kind:relPath#name@line`), so
any extractor computes the same id for the same symbol without a shared
registry — that is what lets the semantic layer link a call site to the exact
declaration node the structural layer emitted.

## Roadmap

- [x] **Embedded query layer** — load into [Kùzu](https://kuzudb.com) (embedded,
  Cypher) with traversal tools: `who-calls`, `calls`, `blast-radius`,
  `dead-exports`, `neighbors`, `find`.
- [x] **Type edges** — `USES_TYPE`, `RETURNS`, `PARAM_TYPE` (plus `INSTANTIATES`)
  resolved through import aliases.
- [x] **Member-aware reference counting** — a class/interface is live when any
  contained member is referenced.
- [x] **Value-reference (`READS`) edges** — value-identifier usage, so exported
  `const`s (e.g. schemas) are no longer false-positive dead exports.
- [x] **Optimization agent** — an LLM tool-calling loop (OpenAI-compatible API,
  provider-agnostic) that proposes edits and keeps them only if `tsc --noEmit`
  passes (otherwise reverts).
- [ ] **Test verification** — run the test suite alongside `tsc` in the verify
  step, so behavior-changing edits are caught, not just type errors.
- [ ] **Vector index** — embed per-node summaries for hybrid graph + semantic
  retrieval, so the agent can find candidates by meaning, not just by name.
