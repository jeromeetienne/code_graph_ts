# Getting Started

This guide walks you from a fresh clone to an autonomous agent applying its
first verified optimization. Total time: about 10 minutes.

## What you are building

The pipeline has three stages, each producing an artifact the next one consumes:

```
TypeScript project ──extract──▶ JSONL graph ──load──▶ Kùzu database ──▶ queries / agent
                                (./outputs/graph/)            (./outputs/graph.kuzu)
```

1. **extract** — parses a TypeScript project with `ts-morph` (the TS compiler
   API) into nodes (modules, classes, functions, types…) and edges (`CALLS`,
   `IMPORTS`, `USES_TYPE`, `READS`…).
2. **load** — imports the JSONL into an embedded [Kùzu](https://kuzudb.com)
   graph database (no server required).
3. **query / optimize** — traversal commands answer impact-analysis questions;
   the `optimize` command hands those same queries to an LLM agent as tools.

## Prerequisites

- **Node.js ≥ 20.12** (the CLI uses `process.loadEnvFile`; check with
  `node --version`)
- For the agent only: access to any **OpenAI-compatible** LLM endpoint —
  OpenAI, OpenRouter, or a local server (Ollama, LM Studio, vLLM)

## 1. Install

```bash
npm install
```

## 2. Extract a graph

The repository itself is a fine first target — the examples below use it.
Point `extract` at any TypeScript project with a `tsconfig.json` to analyze
something else.

```bash
npm run extract -- . --semantic
```

Expected output (counts will vary with the codebase):

```
✓ 120 nodes, 398 edges -> /…/outputs/graph

Nodes
  Method           59
  TypeAlias        14
  ...
Edges
  CALLS            118
  CONTAINS         107
  READS            66
  ...
```

`--semantic` enables symbol resolution: `CALLS`, `EXTENDS`/`IMPLEMENTS`,
`RETURNS`/`PARAM_TYPE`/`USES_TYPE`, `INSTANTIATES`, and `READS` edges. Without
it you get only the fast structural layer (files, declarations, imports,
containment). For everything in this guide, use `--semantic`.

The result is two line-oriented JSON files you can inspect directly:

```bash
head -n 3 outputs/graph/nodes.jsonl
head -n 3 outputs/graph/edges.jsonl
```

## 3. Load it into the query database

```bash
npm run dev -- load
```

This writes the embedded Kùzu database to `./outputs/graph.kuzu` — the default
path every other command reads from, so from here on you can drop `--db`.

> **Re-running after code changes:** the loader merges by node id, so stale
> nodes from a previous extraction are not removed. For a clean state, delete
> the database and reload:
> `rm -rf outputs/graph.kuzu && npm run extract -- . --semantic && npm run dev -- load`

## 4. Query the graph

Node ids always come from a query — never write them by hand. `find` locates
symbols; add `--json` to get their ids:

```bash
npm run dev -- find KuzuStore
#   Class          KuzuStore  src/store/kuzu_store.ts:11

npm run dev -- find KuzuStore --json
#   [{ "id": "ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@11", ... }]
```

Then feed an id into the traversal commands (your line numbers will differ —
ids encode the declaration line, so always copy them from `find --json`):

```bash
# who calls this method, directly?
npm run dev -- who-calls 'MethodDeclaration:src/store/kuzu_store.ts#run@49'

# everything transitively impacted if I change it (the blast radius)
npm run dev -- blast-radius 'MethodDeclaration:src/store/kuzu_store.ts#run@49' --depth 10

# every reference to a symbol or type: calls, type usage, heritage, new, value reads
npm run dev -- references 'TypeAliasDeclaration:src/schema/node.ts#GraphNode@37'

# one-hop neighbourhood, both directions
npm run dev -- neighbors 'ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@11'

# exported symbols nothing references — dead-code candidates
npm run dev -- dead-exports
```

Every query accepts `--json` for machine-readable output — the exact shape the
agent consumes.

## 5. Configure an LLM provider

The agent talks to any OpenAI-compatible chat-completions endpoint. Copy the
sample and pick ONE provider block:

```bash
cp .env-sample .env
```

```bash
# .env — example: OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.1

# example: free local model via Ollama instead
# OPENAI_API_KEY=ollama
# OPENAI_BASE_URL=http://localhost:11434/v1
# OPENAI_MODEL=qwen2.5-coder:32b
```

See [.env-sample](../.env-sample) for OpenRouter, LM Studio, and vLLM blocks.

> **Model choice matters.** The agent must chain tool calls reliably
> (`dead_exports` → `references` → `read_file` → `propose_optimization`).
> Strong tool-calling models do this well; small local models tend to skip the
> verification steps and get their edits rejected.

## 6. Run the agent

**Start from a clean git tree** — the agent edits files, and `git diff` is how
you review what it did.

```bash
npm run dev -- optimize
```

With no task argument it runs the default mission: find one genuinely dead
exported symbol, prove it has zero inbound references, and remove it. You can
direct it explicitly:

```bash
npm run dev -- optimize "Inline the single-use helper formatRow in src/report.ts"
npm run dev -- optimize --model gpt-5.1 --max-steps 20
```

What happens on each proposal:

1. The agent explores the graph with the read-only query tools.
2. It calls `propose_optimization` with an exact find/replace edit.
3. The harness applies the edit and runs `tsc --noEmit`.
4. **Pass** → the edit is kept and reported. **Fail** → the edit is reverted
   and the compiler errors go back to the agent for another attempt.

The run ends with a summary of every kept edit:

```
Applied 1 verified edit(s):
  ✓ src/schema/node.ts — removed unused exported type alias `Range` (zero inbound references)
```

Review with `git diff`, keep what you like, `git checkout -- <file>` what you
don't.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Set OPENAI_API_KEY before running the optimizer` | No `.env` next to `package.json` (or the variable is commented out). `cp .env-sample .env` and fill in one block. |
| `Set OPENAI_MODEL in .env (or pass --model)` | The model line is missing — every provider block in `.env-sample` includes one. |
| Query returns `(no results)` for an id you typed | Ids encode the declaration line (`…@50`) and shift when code changes. Re-run `find` to get the current id — never reuse ids across extractions. |
| `dead-exports` lists a symbol you believe is used | Re-extract + reload first (stale graph). If it persists, check whether the use is dynamic (string-keyed access, reflection) — the graph only sees static references. |
| Kùzu errors about the database directory | Another process may hold the db open, or the db is from an incompatible Kùzu version. `rm -rf outputs/graph.kuzu` and reload. |
| Agent proposes edits that keep getting rejected | The model isn't matching file text exactly. Try a stronger model, or scope the task to a single named symbol. |

## Where to go next

- [Static Analysis guide](STATIC_ANALYSIS.md) — use the query commands by hand
  to answer impact, dead-code, and dependency questions about a codebase
- [README](../README.md) — graph model, architecture, roadmap
- `src/query/graph_query.ts` — add your own traversal (each method maps 1:1 to
  an agent tool)
- `src/agent/optimizer_agent.ts` — the system prompt and the
  propose → verify → keep/revert loop
