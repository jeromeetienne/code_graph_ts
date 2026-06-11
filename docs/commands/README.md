# CLI Command Reference

This directory documents every command registered by the `ts-knowledge-graph`
CLI ([`src/cli.ts`](../../src/cli.ts)). There is one file per command; each one
explains the command's arguments, options, underlying graph query, output
format, and caveats in depth.

## Invocation

The published binary is `ts-knowledge-graph`. Every example in these documents
uses that name:

```bash
ts-knowledge-graph <command> [arguments] [options]
```

During development (running from a clone, before `npm run build`), invoke the
same commands through the bundled npm scripts instead:

| Published binary | Development equivalent |
| --- | --- |
| `ts-knowledge-graph <command>` | `npm run dev -- <command>` |
| `ts-knowledge-graph extract …` | `npm run extract -- …` |
| `ts-knowledge-graph web …` | `npm run web -- …` |

## The pipeline

The commands fall into three groups that run in order. Each stage produces an
artifact the next stage consumes:

```
TypeScript project ──extract──▶ JSONL graph ──load──▶ Kùzu database ──▶ query / optimize / web
                                (./outputs/graph/)            (./outputs/graph.kuzu)
```

### Build the graph

| Command | Purpose |
| --- | --- |
| [`extract`](extract.md) | Parse a TypeScript project into a JSONL knowledge graph. |
| [`load`](load.md) | Import the JSONL graph into an embedded Kùzu database. |

### Query the graph

| Command | Purpose |
| --- | --- |
| [`find`](find.md) | Resolve a name (substring) to node ids. The entry point for every other query. |
| [`who-calls`](who-calls.md) | Direct callers of a symbol. |
| [`calls`](calls.md) | What a symbol calls directly. |
| [`references`](references.md) | Everything that references a symbol or type (calls, type usage, heritage, instantiation, reads). |
| [`neighbors`](neighbors.md) | One-hop neighbourhood of a node, in and out, all edge kinds. |
| [`blast-radius`](blast-radius.md) | Every symbol transitively impacted by changing a node. |
| [`dead-exports`](dead-exports.md) | Exported symbols with no inbound references. |

### Use the graph

| Command | Purpose |
| --- | --- |
| [`optimize`](optimize.md) | Run the autonomous LLM optimization agent against the loaded graph. |
| [`web`](web.md) | Serve the graph in an interactive web visualisation. |

## Common conventions

- **Node ids always come from a query.** Run [`find`](find.md) (add `--json`)
  or read an id out of another query's output. Ids encode the declaration line
  (`kind:relPath#name@line`) and shift whenever the code moves, so never write
  them by hand and never reuse them across extractions.
- **`--db <path>`** defaults to `./outputs/graph.kuzu` on every query command,
  matching `load`'s default output. Override it to query a database elsewhere.
- **`--json`** is available on every query command and emits the exact
  machine-readable shape the optimization agent consumes.

See also: [Getting Started](../GETTING_STARTED.md), the
[Static Analysis guide](../STATIC_ANALYSIS.md) (these commands organised by the
analysis question they answer), and the [project README](../../README.md).
