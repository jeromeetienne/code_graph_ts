# CLI Command Reference

This directory documents every command registered by the `ts-knowledge-graph`
CLI ([npx ts-knowledge-graph](https://www.npmjs.com/package/ts-knowledge-graph)). 
There is one file per command; each one explains the command's arguments, options, underlying graph query, output
format, and caveats in depth.

## Invocation

The published binary is `ts-knowledge-graph`. Every example in these documents
runs it with `npx` (no global install required):

```bash
npx ts-knowledge-graph <command> [arguments] [options]
```

## The pipeline

The commands fall into three groups that run in order. Each stage produces an
artifact the next stage consumes:

```
TypeScript project ──extract──▶ JSONL graph ──load──▶ Kùzu database ──▶ query / web
                                (./outputs/graph/)            (./outputs/graph.kuzu)
                                                                    ▲
                                          V8 .cpuprofile ──enrich──┘
```

### Build the graph

| Command | Purpose |
| --- | --- |
| [`extract`](extract.md) | Parse a TypeScript project into a JSONL knowledge graph. |
| [`load`](load.md) | Import the JSONL graph into an embedded Kùzu database. |

### Enrich the graph

| Command | Purpose |
| --- | --- |
| [`enrich`](enrich.md) | Ingest a V8 CPU profile and attach measured runtime metrics (`metadata.runtime`) onto nodes. |
| [`cluster`](cluster.md) | Detect code communities with the Leiden algorithm and attach the module index (`metadata.community`) onto nodes. |

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
| [`hotspots`](hotspots.md) | Rank nodes by optimization leverage — runtime self-time, fan-in, call-count, or blast radius. |
| [`cost`](cost.md) | Propagate self cost into inclusive cost and rank nodes by share of total; or break one node's cost into callee/caller attribution. |

### Verify & measure an edit

| Command | Purpose |
| --- | --- |
| [`verify`](verify.md) | Run the project's `typecheck` + `test` scripts as one keep/revert gate for an edit; degrades to type-check-only, reported honestly, when there is no test script. |
| [`benchmark`](benchmark.md) | Measure a target node's runtime metric (profile → enrich → cost) over N runs and report the median + spread, with an advisory baseline→after delta. |

### Use the graph

| Command | Purpose |
| --- | --- |
| [`webview`](webview.md) | Serve the graph in an interactive web visualisation. |
| [`install`](install.md) | Copy the bundled Claude Code commands and skill into a project's `.claude/`. |

The autonomous optimization agent is not a CLI command. It is the
`/code-graph-optimize` [Claude Code](https://claude.com/claude-code) slash
command (defined under
[`dotclaude_folder/commands/`](../../dotclaude_folder/commands)), which calls the
query commands above to find a verified-safe edit and apply it. Run
[`install`](install.md) once to copy that command — and its read-only
`/code-graph-interview` companion and the `code-graph-query` skill — into the
target project's `.claude/` directory.

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
