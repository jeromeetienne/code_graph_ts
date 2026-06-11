---
name: code-graph-query
description: >-
  Query a TypeScript codebase as a knowledge graph to answer impact, caller,
  dependency, and dead-code questions. Use this instead of grep/glob for
  "who calls X", "what breaks if I change X" (blast radius), "is X dead code",
  "what references this type", and "what is X connected to". Requires the
  ts-knowledge-graph CLI and a built graph database.
---

# code-graph-query

Answer structural questions about a TypeScript project by querying a semantic
knowledge graph (built with the TypeScript compiler API) rather than reading or
grepping source files. The graph has resolved symbols and types, so its answers
are precise where text search is not.

## When to use this skill

Reach for these commands — not `Grep`/`Glob` — when the question is about code
structure or impact:

- **Callers** — "who calls this function?" → `who-calls`
- **Callees** — "what does this function call?" → `calls`
- **Impact / blast radius** — "what breaks if I change this?" → `blast-radius`
- **References** — "what uses this symbol or type?" → `references`
- **Dead code** — "which exports are unused?" → `dead-exports`
- **Neighbourhood** — "what is this connected to?" → `neighbors`

For reading the actual implementation of a known file, normal file tools are
still the right choice. Use this skill to decide *which* code matters first.

## Prerequisite: build the graph once

Querying needs a Kùzu database at `./outputs/graph.kuzu`. If it is missing,
build it first (the `--semantic` flag is required for `CALLS` and heritage
edges, which power `who-calls`, `calls`, and `blast-radius`):

```bash
npx ts-knowledge-graph extract <path-to-project> --semantic   # writes ./outputs/graph/*.jsonl
npx ts-knowledge-graph load                                   # writes ./outputs/graph.kuzu
```

Inside this repository's own checkout, substitute `npm run dev --` for the
`ts-knowledge-graph` binary (e.g. `npm run dev -- load`).

## Core workflow: names are not ids

Every query that inspects a symbol takes a **node id**, not a name. Resolve a
name to id(s) first with `find`, then pass an id to the other commands. Never
hand-write ids.

```bash
npx ts-knowledge-graph find <name> --json        # -> array of { id, name, kind, filePath, startLine }
npx ts-knowledge-graph who-calls <id> --json     # use an id from the find result
```

Always pass `--json`; consume the JSON, not the human-readable output.

## Command reference

All commands accept `--json` and `-d, --db <path>` (default `./outputs/graph.kuzu`).

| Command | Argument | Purpose |
| --- | --- | --- |
| `find <pattern>` | name substring | resolve a name to node id(s) |
| `who-calls <id>` | node id | direct callers of a symbol |
| `calls <id>` | node id | what a symbol directly calls |
| `blast-radius <id> [--depth <n>]` | node id | transitive callers / impact set (default depth 10) |
| `references <id>` | node id | everything referencing a symbol/type (calls, type usage, heritage, new) |
| `neighbors <id>` | node id | one-hop neighbourhood, inbound and outbound |
| `dead-exports` | (none) | exported symbols with no inbound references |

## Output contract

- `find`, `who-calls`, `calls`, `blast-radius`, `dead-exports` return a JSON
  array of `SymbolRef`: `{ id, kind, name, filePath, startLine }`.
- `references` and `neighbors` return `NeighborRef`: a `SymbolRef` plus
  `edgeKind` and `direction` (`"in"` or `"out"`).

## Worked example

> "Is it safe to change the signature of `loadProject`?"

```bash
npx ts-knowledge-graph find loadProject --json          # -> get its id
npx ts-knowledge-graph blast-radius <id> --json         # -> every symbol transitively impacted
```

Report the impacted set (file paths + names) as the blast radius, then read
those specific call sites to judge the change.
