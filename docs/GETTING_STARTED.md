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
   the `/code-graph-optimize` Claude Code command hands those same queries to an
   agent as tools.

## Prerequisites

- **Node.js ≥ 20.12** (check with `node --version`)
- For the agent only: [Claude Code](https://claude.com/claude-code) — the
  optimization agent is the `/code-graph-optimize` slash command, so there is no
  API key or LLM provider to configure

## 1. Install

```bash
npm install
```

## 2. Extract a graph

The repository itself is a fine first target — the examples below use it.
Point `extract` at any TypeScript project with a `tsconfig.json` to analyze
something else.

```bash
npx ts-knowledge-graph extract . --semantic
```

Expected output — the figures are illustrative and vary with the codebase and
version, so they are shown as a shape rather than exact counts:

```
✓ ~390 nodes, ~1.3k edges -> /…/outputs/graph

Nodes
  Method           …
  Variable         …
  TypeAlias        …
  …
Edges
  CONTAINS         …
  READS            …
  CALLS            …
  …
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
npx ts-knowledge-graph load
```

This writes the embedded Kùzu database to `./outputs/graph.kuzu` — the default
path every other command reads from, so from here on you can drop `--db`.

> **Re-running after code changes:** the loader merges by node id, so stale
> nodes from a previous extraction are not removed. For a clean state, delete
> the database and reload:
> `rm -rf outputs/graph.kuzu && npx ts-knowledge-graph extract . --semantic && npx ts-knowledge-graph load`

## 4. Query the graph

Node ids always come from a query — never write them by hand. `find` locates
symbols; add `--json` to get their ids:

```bash
npx ts-knowledge-graph find KuzuStore
#   Class          KuzuStore  src/store/kuzu_store.ts:11

npx ts-knowledge-graph find KuzuStore --json
#   [{ "id": "ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@11", ... }]
```

Then feed an id into the traversal commands (your line numbers will differ —
ids encode the declaration line, so always copy them from `find --json`):

```bash
# who calls this method, directly?
npx ts-knowledge-graph who-calls 'MethodDeclaration:src/store/kuzu_store.ts#run@49'

# everything transitively impacted if I change it (the blast radius)
npx ts-knowledge-graph blast-radius 'MethodDeclaration:src/store/kuzu_store.ts#run@49' --depth 10

# every reference to a symbol or type: calls, type usage, heritage, new, value reads
npx ts-knowledge-graph references 'TypeAliasDeclaration:src/schema/node.ts#GraphNode@37'

# one-hop neighbourhood, both directions
npx ts-knowledge-graph neighbors 'ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@11'

# exported symbols nothing references — dead-code candidates
npx ts-knowledge-graph dead-exports
```

Every query accepts `--json` for machine-readable output — the exact shape the
agent consumes.

## 5. Run the optimization agent

The agent ships as a [Claude Code](https://claude.com/claude-code) slash
command, `/code-graph-optimize`, defined in
[`dotclaude_folder/commands/`](../dotclaude_folder/commands). There is no
provider, API key, or `.env` to configure — the agent runtime is Claude Code
itself. The commands are mirrored into `.claude/` (already committed in this
repository; for another project, run `npm run symlink:dotclaude` or copy the
files under `dotclaude_folder/` into that project's `.claude/`).

**Start from a clean git tree** — the agent edits files, and `git diff` is how
you review what it did. Then, inside Claude Code:

```text
/code-graph-optimize
```

With no argument it runs the default mission: find one genuinely dead exported
symbol, prove it has zero inbound references, and remove it. You can direct it
explicitly:

```text
/code-graph-optimize Inline the single-use helper formatRow in src/report.ts
```

What happens on each run:

1. The command explores the graph with the read-only query commands
   (`dead-exports`, `references`, `who-calls`, `blast-radius`).
2. It makes exactly one edit with the Edit tool.
3. It runs `npm run typecheck`.
4. **Pass** → the edit stands. **Fail** → it reverts with `git restore <file>`,
   then retries with a different edit or abandons the change.

It finishes by reporting the file changed, the symbol removed, and why removal
was safe — or that it found no safe change. Review with `git diff`, keep what
you like, `git checkout -- <file>` what you don't.

A read-only companion command, `/code-graph-interview`, interviews you to scope
a measurable optimization target and grounds each candidate in the graph,
producing tasks you can then hand to `/code-graph-optimize`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/code-graph-optimize` is not a known command | The commands are not mirrored into `.claude/`. Run `npm run symlink:dotclaude`, or copy the files under `dotclaude_folder/` into the project's `.claude/`. |
| Query returns `(no results)` for an id you typed | Ids encode the declaration line (`…@50`) and shift when code changes. Re-run `find` to get the current id — never reuse ids across extractions. |
| `dead-exports` lists a symbol you believe is used | Re-extract + reload first (stale graph). If it persists, check whether the use is dynamic (string-keyed access, reflection) — the graph only sees static references. |
| Kùzu errors about the database directory | Another process may hold the db open, or the db is from an incompatible Kùzu version. `rm -rf outputs/graph.kuzu` and reload. |
| The agent keeps reverting the edit it tries | Each candidate breaks `npm run typecheck`, so the command restores the file. Scope the task to a single named symbol, or steer it toward a clearer dead-code target. |

## Where to go next

- [Static Analysis guide](STATIC_ANALYSIS.md) — use the query commands by hand
  to answer impact, dead-code, and dependency questions about a codebase
- [README](../README.md) — graph model, architecture, roadmap
- `src/query/graph_query.ts` — add your own traversal (each method maps 1:1 to
  a query command the agent calls)
- [`dotclaude_folder/commands/code-graph-optimize.md`](../dotclaude_folder/commands/code-graph-optimize.md)
  — the optimization agent's instructions: the find → confirm → edit → verify →
  revert method
