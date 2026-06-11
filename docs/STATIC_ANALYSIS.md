# Static Analysis with ts_knowledge_graph

This guide shows how to use `ts_knowledge_graph` as a **static analysis** tool —
answering questions about a TypeScript codebase without running it. The
optimization agent is one consumer of the graph; this document is about the
layer underneath it, the one you drive by hand or from a script.

Static analysis here means reasoning over a *semantic* model of the code: a
graph whose nodes are declarations (modules, classes, functions, types…) and
whose edges are the relationships the TypeScript compiler resolves between them
(`CALLS`, `USES_TYPE`, `EXTENDS`, `READS`…). Because the graph is built on
`ts-morph` (the TypeScript Compiler API), a call site is linked to the exact
declaration it resolves to — across files and through import aliases — not to
every symbol that merely shares its name.

The questions this is good at are the ones that require following those
relationships transitively:

| Question | Command |
| --- | --- |
| What exported code is unused? | [`dead-exports`](#1-find-dead-code) |
| If I change this, what breaks? | [`blast-radius`](#2-analyse-change-impact-blast-radius) / [`who-calls`](#2-analyse-change-impact-blast-radius) |
| Is it safe to rename or delete this? | [`references`](#3-find-every-reference-rename--delete-safety) |
| What does this symbol depend on? | [`calls`](#4-trace-forward-dependencies) / [`neighbors`](#5-inspect-a-symbols-neighbourhood) |
| How is this symbol wired into the rest? | [`neighbors`](#5-inspect-a-symbols-neighbourhood) |
| What types ripple out from this type? | [`references`](#6-trace-type-level-impact) |

## Setup: build the graph once

Every analysis below reads from a loaded Kùzu database. Build it with two
commands, and **always extract with `--semantic`** — the type and behavioral
edges that make static analysis useful (`CALLS`, `USES_TYPE`, `READS`, heritage)
only exist in a semantic extraction. Without it you get the structural skeleton
(files, declarations, imports, containment) and little to analyse.

```bash
# 1. parse the project into a JSONL graph (point it at any tsconfig project)
ts-knowledge-graph extract . --semantic

# 2. load the JSONL into the embedded query database
ts-knowledge-graph load
```

That writes `./outputs/graph.kuzu`, the default every query command reads from.
See [Getting Started](GETTING_STARTED.md) for a fuller walk-through and
[`extract`](commands/extract.md) / [`load`](commands/load.md) for all options.

> **Running from a clone (before `npm run build`)?** Replace `ts-knowledge-graph
> <command>` with `npm run dev -- <command>`, and `ts-knowledge-graph extract`
> with `npm run extract --`. The examples below use the published binary name.

> **Re-extract after editing code.** The loader merges by node id and does not
> remove stale nodes, so a renamed or deleted symbol lingers until you rebuild.
> For a trustworthy reading start clean:
> `rm -rf outputs/graph.kuzu outputs/graph && ts-knowledge-graph extract . --semantic && ts-knowledge-graph load`

## How to read the graph

Two rules cover almost every command:

- **Node ids always come from a query, never your keyboard.** An id encodes the
  declaration line (`kind:relPath#name@line`) and shifts whenever the code
  moves. Get one from [`find --json`](commands/find.md), or copy it out of
  another query's output. The line numbers in the examples below will differ in
  your tree — that is expected.
- **A "reference" is a use, not a mention.** Eight edge kinds count as a symbol
  being *used*: `CALLS`, `IMPLEMENTS`, `EXTENDS`, `USES_TYPE`, `RETURNS`,
  `PARAM_TYPE`, `INSTANTIATES`, `READS`. Structural and mutation edges
  (`CONTAINS`, `IMPORTS`, `EXPORTS`, `OVERRIDES`, `WRITES`) do not — being
  imported or exported is not a use. This set is what [`dead-exports`](#1-find-dead-code)
  and [`references`](#3-find-every-reference-rename--delete-safety) walk.

Every query command accepts `--json` for machine-readable output and `--db
<path>` to point at a database other than the default.

---

## Recipes

### 1. Find dead code

**Question:** which exported symbols does nothing reference, so I can delete
them?

```bash
ts-knowledge-graph dead-exports
```

```
TypeAlias      OptimizerParams  src/agent/optimizer_agent.ts:32
Class          Cli  src/cli.ts:16
TypeAlias      EdgeKind  src/schema/edge.ts:20
TypeAlias      Range  src/schema/node.ts:26

4 result(s)
```

`dead-exports` scans the whole graph for exported nodes with zero inbound
reference edges. It is **member-aware** — a class or interface stays live if any
of its methods or properties is referenced, even when the container name is
never used directly — and it counts the `READS` edge, so exported `const`s used
only as values (Zod schemas, lookup tables) are not false positives. See
[`dead-exports`](commands/dead-exports.md) for the exact query.

Treat the output as *candidates*, not a kill list. In the run above, `Cli` is
exported but reachable only through `Cli.run(process.argv)` at module scope —
the kind of entry point a static reference walk cannot see (more on that under
[Limitations](#what-the-analysis-cannot-see)). Confirm each candidate with
[`references`](#3-find-every-reference-rename--delete-safety) before removing it.

### 2. Analyse change impact (blast radius)

**Question:** if I rewrite this function, what is the full set of code that
could be affected?

First resolve the symbol to an id, then walk callers transitively:

```bash
ts-knowledge-graph find run --json        # copy the id of the symbol you mean
ts-knowledge-graph blast-radius 'MethodDeclaration:src/store/kuzu_store.ts#run@52' --depth 10
```

```
Method         dispatch  src/agent/agent_tools.ts:124
Method         run  src/agent/optimizer_agent.ts:57
Method         run  src/cli.ts:17
Method         register  src/commands/blast_radius_command.ts:9
...
Method         whoCalls  src/query/graph_query.ts:29
Method         find  src/query/graph_query.ts:107

22 result(s)
```

`blast-radius` walks `CALLS` edges **backwards** from the target up to `--depth`
hops and returns the deduplicated set of everything that can reach it. For just
the direct callers — the first hop — use [`who-calls`](commands/who-calls.md),
which is `blast-radius --depth 1`:

```bash
ts-knowledge-graph who-calls 'MethodDeclaration:src/store/kuzu_store.ts#run@52'
```

```
Method         buildDataScript  src/commands/web_command.ts:76
Method         whoCalls  src/query/graph_query.ts:29
Method         calls  src/query/graph_query.ts:40
...
8 result(s)
```

This is the safety check before a refactor: the smaller and more local the blast
radius, the safer the edit. Note it follows `CALLS` only — for type-level ripple
see [recipe 6](#6-trace-type-level-impact).

### 3. Find every reference (rename / delete safety)

**Question:** before I rename or remove this symbol, what touches it — not just
callers, but every kind of use?

```bash
ts-knowledge-graph references 'TypeAliasDeclaration:src/schema/node.ts#GraphNode@37'
```

```
<- PARAM_TYPE   printBreakdown  src/commands/extract_command.ts:46
<- PARAM_TYPE   extractImports  src/extract/structural_extractor.ts:50
<- PARAM_TYPE   write  src/store/jsonl_store.ts:7
<- PARAM_TYPE   load  src/store/kuzu_store.ts:29
<- RETURNS      getNodes  src/extract/graph_builder.ts:30
<- USES_TYPE    Extraction  src/extract/structural_extractor.ts:12
<- USES_TYPE    GraphData  src/store/jsonl_reader.ts:7

10 edge(s)
```

Where [`who-calls`](commands/who-calls.md) sees only `CALLS`, `references`
reports all eight reference edge kinds and labels each one — so for a *type* like
`GraphNode` you see the parameters, return positions, and type aliases that
depend on it, which calls alone would miss entirely. An empty result is the
graph's strongest signal that a symbol is safe to delete; pair it with
[`dead-exports`](#1-find-dead-code) to confirm a candidate. See
[`references`](commands/references.md).

### 4. Trace forward dependencies

**Question:** what does this function call — what would I need to understand to
read it?

```bash
ts-knowledge-graph calls 'MethodDeclaration:src/query/graph_query.ts#whoCalls@29'
```

```
Variable       RETURN_REF  src/query/graph_query.ts:19
Method         toRefs  src/query/graph_query.ts:119
Method         run  src/store/kuzu_store.ts:52

3 result(s)
```

`calls` is the forward direction of [`who-calls`](commands/who-calls.md): the
symbols this one invokes directly. Following it outward sketches a top-down call
tree from any entry point. See [`calls`](commands/calls.md).

### 5. Inspect a symbol's neighbourhood

**Question:** how is this class wired into the rest of the code — everything one
hop away, in both directions and across all edge kinds?

```bash
ts-knowledge-graph neighbors 'ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@13'
```

```
-> CONTAINS     initSchema  src/store/kuzu_store.ts:23
-> CONTAINS     run  src/store/kuzu_store.ts:52
-> CONTAINS     close  src/store/kuzu_store.ts:63
<- INSTANTIATES withQuery  src/commands/command_helpers.ts:36
<- INSTANTIATES run  src/commands/load_command.ts:20
<- USES_TYPE    store  src/query/graph_query.ts:23
<- READS        run  src/store/kuzu_store.ts:52

16 edge(s)
```

`neighbors` is the most general single-step view: outgoing edges (`->`) show
what the node owns and uses; incoming edges (`<-`) show who depends on it,
labelled by relationship. Here it reads as a quick structural summary of
`KuzuStore` — its members (`CONTAINS`), the three call sites that construct it
(`INSTANTIATES`), and the field that holds it (`USES_TYPE`). See
[`neighbors`](commands/neighbors.md).

### 6. Trace type-level impact

**Question:** if I change this type, which signatures and other types are
affected?

[`blast-radius`](#2-analyse-change-impact-blast-radius) follows `CALLS` and so
says nothing about types. Type impact lives in three reference edges —
`USES_TYPE`, `RETURNS`, `PARAM_TYPE` — which [`references`](#3-find-every-reference-rename--delete-safety)
reports. Re-reading the `GraphNode` output in recipe 3: every `PARAM_TYPE` row is
a function whose parameter is typed `GraphNode`, every `RETURNS` row a function
that returns it, and every `USES_TYPE` row a type alias built on it. That is the
set of declarations a breaking change to `GraphNode`'s shape would force you to
revisit.

---

## Scripting and CI integration

Add `--json` to any query for a stable shape you can pipe into `jq` or feed to
another tool. The structure is an array of `{ id, kind, name, filePath,
startLine }` (with `edgeKind` / `direction` added for `references` and
`neighbors`).

Gate a build on dead code — exit non-zero when any exported symbol is unused:

```bash
ts-knowledge-graph dead-exports --json | jq -e 'length == 0' > /dev/null \
  || { echo 'Dead exports found:'; ts-knowledge-graph dead-exports; exit 1; }
```

List just the file paths impacted by a change, for a reviewer checklist:

```bash
ts-knowledge-graph blast-radius "$ID" --depth 10 --json | jq -r '.[].filePath' | sort -u
```

Count direct callers of every match for a name (a cheap fan-in metric):

```bash
ts-knowledge-graph find handleRequest --json \
  | jq -r '.[].id' \
  | while read -r id; do
        n=$(ts-knowledge-graph who-calls "$id" --json | jq 'length')
        echo "$n  $id"
    done | sort -rn
```

A clean rebuild and these checks fit naturally into a pre-merge job; just
remember to wipe `outputs/graph.kuzu` first so the reading is not stale.

## Custom analyses

The two built-in traversal shapes — backward `CALLS` (`blast-radius`) and the
reference edge set (`references`) — do not cover every question. For anything
else you have two options.

**Write Cypher against the database directly.** `outputs/graph.kuzu` is a
standard embedded [Kùzu](https://kuzudb.com) database with a two-table schema:

```cypher
// Node table: GraphNode (id, kind, name, filePath, exported, startLine, endLine)
// Rel  table: Edge (FROM GraphNode TO GraphNode, kind)

// Example: the ten most-called symbols (highest fan-in)
MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode)
WHERE e.kind = 'CALLS'
RETURN callee.name, callee.filePath, count(caller) AS callers
ORDER BY callers DESC
LIMIT 10
```

Open it with the Kùzu CLI or any Kùzu client. Every relationship carries its
type in the `kind` property; the [`NODE_KINDS`](../src/schema/node.ts) and
[`EDGE_KINDS`](../src/schema/edge.ts) enums are the full vocabulary.

**Add a method to `GraphQuery`.** Each method in
[`src/query/graph_query.ts`](../src/query/graph_query.ts) is a small Cypher query
that returns `SymbolRef`s, and the existing ones are the best templates. A new
method becomes a new analysis you can call from code (and, by the same pattern,
expose to the agent as a tool).

## What the analysis cannot see

The graph is a *static* model. Knowing its blind spots is what separates a
trustworthy reading from a misleading one.

- **Dynamic dispatch and reflection are invisible.** A method reached only
  through a computed property (`obj[name]()`), a string-keyed lookup table, or a
  framework that wires handlers by name has no `CALLS` edge. Such a symbol can
  look dead or show an artificially small blast radius while being heavily used
  at runtime.
- **Module-scope entry points look unused.** Code invoked at the top level of a
  module — `Cli.run(process.argv)` at the bottom of `cli.ts`, a CLI's `main()`,
  test bootstrap — is the program's real entry, yet `dead-exports` may flag it
  because the reference does not originate from another declaration node. Always
  sanity-check `dead-exports` candidates against how the program actually starts.
- **`blast-radius` is `CALLS`-only.** It deliberately ignores type edges, so the
  *runtime* impact of a change is captured but the *type-checking* impact is not.
  Combine it with [`references`](#6-trace-type-level-impact) for the full picture.
- **A stale graph lies confidently.** Because `load` merges rather than replaces,
  an out-of-date database reports symbols and ids that no longer exist (and the
  duplicate-looking entries that come from a file rename). Re-extract before
  trusting any result you intend to act on.
- **Node ids are line-bound.** An id like `…#run@52` pins the declaration line.
  Reusing an id across extractions, or after an edit, silently queries the wrong
  thing or returns nothing. Always re-`find`.
- **Structural-only graphs cannot answer these questions at all.** If you skipped
  `--semantic`, there are no `CALLS`, type, or `READS` edges, so `dead-exports`
  flags nearly everything and the traversals return empty. Re-extract with
  `--semantic`.

## See also

- [Getting Started](GETTING_STARTED.md) — the end-to-end pipeline from clone to
  agent.
- [CLI command reference](commands/README.md) — every command's arguments,
  options, and underlying query in depth.
- [`dead-exports`](commands/dead-exports.md) ·
  [`blast-radius`](commands/blast-radius.md) ·
  [`references`](commands/references.md) ·
  [`who-calls`](commands/who-calls.md) ·
  [`calls`](commands/calls.md) · [`neighbors`](commands/neighbors.md) ·
  [`find`](commands/find.md)
- [Project README](../README.md) — graph model, architecture, and roadmap.
