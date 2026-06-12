# `extract`

Parse a TypeScript project into a knowledge graph and write it to disk as two
JSONL files — the first stage of the pipeline.

Source: [`src/commands/extract_command.ts`](../../src/commands/extract_command.ts)

## Synopsis

```bash
npx ts-knowledge-graph extract <root> [options]
```

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `<root>` | yes | Path to the TypeScript project to parse. Must contain a `tsconfig.json`; the project is loaded through `ts-morph` from that config. |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <dir>` | `./outputs/graph` | Output directory for the JSONL graph. Two files are written into it: `nodes.jsonl` and `edges.jsonl`. |
| `--semantic` | `false` | Resolve heritage, `CALLS`, and type edges. Slower (requires symbol + type resolution) but produces the edges every analysis command depends on. |

## What it does

1. Resolves `<root>` and `--out` to absolute paths.
2. `ProjectLoader.load(root)` builds a `ts-morph` `Project` from the project's
   `tsconfig.json`. `ts-morph` wraps the TypeScript Compiler API, so the graph
   has access to real symbol and type information — not just syntax.
3. `GraphBuilder.build(project, root, { semantic })` walks the project and emits
   nodes and edges, deduplicating by node id.
4. `JsonlStore.write(out, nodes, edges)` serializes the graph as line-oriented
   JSON — one record per line — into `nodes.jsonl` and `edges.jsonl`.
5. Prints a count summary and a per-kind breakdown.

## The two extraction layers

The extractor emits two layers. The split is what `--semantic` toggles.

**Structural layer — always emitted (fast).** Modules, declarations, imports,
containment, and the system-level config and outbound-HTTP surfaces. It needs no
symbol resolution, so it is cheap.

- Node kinds: `Module`, `Class`, `Interface`, `TypeAlias`, `Enum`, `Function`,
  `Method`, `Property`, `Parameter`, `Variable`, `ExternalModule`, `ConfigFlag`,
  `ExternalAPI`.
- Edge kinds: `CONTAINS`, `IMPORTS`, `EXPORTS`, `READS_CONFIG`, `CALLS_EXTERNAL`.

`ConfigFlag` nodes are detected from `process.env.X` / `process.env['X']` reads
(with a `READS_CONFIG` edge from the reading declaration); `ExternalAPI` nodes are
detected from `fetch(...)` call sites, one per called host (with a `CALLS_EXTERNAL`
edge from the caller).

**Semantic layer — only with `--semantic` (slower).** Heritage, calls, and type
relationships. These require resolving each identifier to the declaration it
refers to.

- Type edges: `EXTENDS`, `IMPLEMENTS`, `USES_TYPE`, `RETURNS`, `PARAM_TYPE`.
- Behavioral edges: `CALLS`, `INSTANTIATES`, `OVERRIDES`, `READS`, `WRITES`.

Without `--semantic` you get a file/declaration/import skeleton with no `CALLS`,
no `references`, and no usable `dead-exports`. **For every query and the
optimization agent, extract with `--semantic`.**

## Node ids

Each node gets a deterministic id derived purely from the declaration, so any
extraction pass computes the same id for the same symbol without a shared
registry:

```
<SyntaxKind>:<project-relative-path>#<name>@<startLine>

ClassDeclaration:src/store/kuzu_store.ts#KuzuStore@11
Module:src/cli.ts
External:commander
```

Because the id encodes the declaration's start line, it changes whenever the
declaration moves. This is why ids must always be re-read from a fresh query
rather than reused across extractions.

## Output

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

The breakdown lists node kinds then edge kinds, each sorted by count descending.
The figures are illustrative — exact counts vary with the codebase and version.
The files themselves are plain JSONL and can be inspected directly:

```bash
head -n 3 outputs/graph/nodes.jsonl
head -n 3 outputs/graph/edges.jsonl
```

## Examples

```bash
# structural graph only (fast) — files, declarations, imports
npx ts-knowledge-graph extract ./my-project

# full graph with heritage, CALLS, and type edges
npx ts-knowledge-graph extract ./my-project --semantic

# analyze this repository itself, into a custom directory
npx ts-knowledge-graph extract . --semantic --out ./outputs/self
```

## Notes and caveats

- The target project must have a `tsconfig.json`; `ProjectLoader` loads from it.
- The graph only captures **static** structure. Dynamic dispatch, string-keyed
  property access, and reflection are invisible to it.
- After changing source code, re-run `extract` then [`load`](load.md) to refresh
  the database. The loader merges by id and does not delete stale nodes, so for
  a clean state delete the database first (see [`load`](load.md)).

## See also

- [`load`](load.md) — import the JSONL output into the query database.
- [Getting Started](../GETTING_STARTED.md) — the full extract → load → query walkthrough.
