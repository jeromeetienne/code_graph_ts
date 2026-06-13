# Documentation Index

The root of the `ts_knowledge_graph` documentation. This page describes every
file under `./docs/` so you can find the right one quickly.

## Guides

| Document | What it covers |
| --- | --- |
| [Getting Started](GETTING_STARTED.md) | End-to-end walk-through of the pipeline — extract a graph, load it into Kùzu, query it, and run the optimization agent on its first verified edit. Start here. |
| [Static Analysis](STATIC_ANALYSIS.md) | Task-oriented guide to using the query commands by hand for static analysis: dead-code detection, change-impact (blast radius), reference lookup for rename and delete safety, dependency tracing, and the static-analysis blind spots. |

## Command reference

The [`commands/`](commands/README.md) directory documents every command of the
`ts-knowledge-graph` CLI, one file per command — arguments, options, the
underlying graph query, output format, and caveats in depth.
[`commands/README.md`](commands/README.md) is the overview, with the invocation
convention and shared options.

The commands fall into three groups that run in order, each producing an
artifact the next stage consumes:

### Build the graph

| Command | Purpose |
| --- | --- |
| [`extract`](commands/extract.md) | Parse a TypeScript project into a JSONL knowledge graph. |
| [`load`](commands/load.md) | Import the JSONL graph into an embedded Kùzu database. |

### Query the graph

| Command | Purpose |
| --- | --- |
| [`find`](commands/find.md) | Resolve a name to node ids. The entry point for every other query. |
| [`who-calls`](commands/who-calls.md) | Direct callers of a symbol. |
| [`calls`](commands/calls.md) | What a symbol calls directly. |
| [`references`](commands/references.md) | Everything that references a symbol or type (calls, type usage, heritage, instantiation, reads). |
| [`neighbors`](commands/neighbors.md) | One-hop neighbourhood of a node, in and out, all edge kinds. |
| [`blast-radius`](commands/blast-radius.md) | Every symbol transitively impacted by changing a node. |
| [`dead-exports`](commands/dead-exports.md) | Exported symbols with no inbound references. |
| [`hotspots`](commands/hotspots.md) | Rank nodes by optimization leverage — runtime self-time, fan-in, call-count, or blast radius. |
| [`cost`](commands/cost.md) | Propagate self cost into inclusive cost and rank nodes by share of total; or break one node's cost into callee/caller attribution. |
| [`cluster`](commands/cluster.md) | Detect code communities (modules) with the Leiden algorithm; attach the community index as `metadata.community`. |

### Use the graph

| Command | Purpose |
| --- | --- |
| [`webview`](commands/webview.md) | Serve the graph in an interactive web visualisation. |
| [`install`](commands/install.md) | Copy the bundled Claude Code commands and skill into a project's `.claude/`. |

The optimization agent is no longer a CLI command. It ships as the
`/code-graph-optimize` [Claude Code](https://claude.com/claude-code) slash
command (with a read-only `/code-graph-interview` companion), defined under
[`dotclaude_folder/commands/`](../dotclaude_folder/commands). Both drive the
query commands above to find and apply verified-safe optimizations. Run
[`install`](commands/install.md) to copy them — and the `code-graph-query`
skill — into a target project's `.claude/` directory.

## See also

- [Project README](../README.md) — graph model, architecture, and roadmap.
