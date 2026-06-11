---
title: 'What Breaks If I Change This? Static Analysis the Graph Can Actually Answer'
subtitle: 'Blast radius, dead code, and safe refactors — the graph put to work, and an honest look at its blind spots.'
description: >-
  The code knowledge graph is built and loaded. This post drives it by hand to
  answer the questions you ask before touching code — what's dead, what breaks,
  what's safe to rename — on real output, and is candid about the things a static
  graph cannot see.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - static-analysis
  - refactoring
  - dead-code
  - typescript
  - developer-tools
series: 'Code as a Knowledge Graph'
series_part: 5
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# What Breaks If I Change This? Static Analysis the Graph Can Actually Answer

We've spent four posts building toward a graph you can traverse. Time to collect
the dividend. This post is the practical one: driving the graph by hand to answer
the questions that come up *before* you change code — what's dead, what breaks,
what's safe to touch.

These are the use cases that work **today**, with no runtime data at all. They
live entirely in the maintainability dimension from
[Post 2](./02_causal_knowledge_graph_vision.article.md), and that's exactly why
they're a fair test: no telemetry, no benchmarks, just the structure and the type
system. If the graph can't earn its keep here, it can't earn it anywhere.

## Build it once

Two commands, and the second flag is not optional:

```bash
npx ts-knowledge-graph extract . --semantic
npx ts-knowledge-graph load
```

`--semantic` is what gives you `CALLS`, type, and `READS` edges. Skip it and you
get the structural skeleton — files, declarations, imports — and almost nothing to
analyze. (Skip it and `dead-exports` will cheerfully flag nearly your entire
codebase, because with no reference edges, *nothing* looks used.)

Two rules cover how to read the graph, and internalizing them up front saves a
lot of confusion:

1. **Node ids come from a query, never your keyboard.** An id like
   `MethodDeclaration:src/store/kuzu_store.ts#run@52` pins the declaration's
   *line*. It shifts whenever the code moves, so you always get one from `find`
   or copy it out of another query — you never type it.
2. **A "reference" is a use, not a mention.** Eight edge kinds count as a symbol
   being *used*: `CALLS`, `IMPLEMENTS`, `EXTENDS`, `USES_TYPE`, `RETURNS`,
   `PARAM_TYPE`, `INSTANTIATES`, `READS`. Being *imported* or *exported* is not a
   use. That distinction is the whole game in dead-code detection.

The project ships three deliberately-flawed sample projects to exercise this —
`text-kit` (structural layer, dead exports), `calc` (behavioral layer, inlinable
helpers), and `shapes` (type layer, a redundant override). I'll use the tool's
analysis of *its own* source for the examples below, because there's no better
honesty test than pointing a tool at itself.

## Question 1: What's dead? *(the `text-kit` case)*

The question: which exported symbols does nothing reference, so I can delete them?

```bash
npx ts-knowledge-graph dead-exports
```

```
Class          Cli       src/cli.ts:15
TypeAlias      EdgeKind  src/schema/edge.ts:20
TypeAlias      Range     src/schema/node.ts:26

3 result(s)
```

`dead-exports` finds exported nodes with zero inbound reference edges. Two details
make it trustworthy rather than noisy. It's **member-aware**: a class stays alive
if any of its methods or properties is used, even when the class *name* never
appears. And it counts the `READS` edge, so an exported `const` used only as a
value — a Zod schema, a lookup table — is not a false positive. On this very
repository it reports exactly the two genuinely-unused type aliases (`EdgeKind`,
`Range`) and nothing else.

But look at the third result, and at the first: `Cli`. It's flagged — and it is
*not* dead. It's the program's entry point, reached through `Cli.run(process.argv)`
at the bottom of the file, a module-scope call no declaration-to-declaration edge
captures. Which is the right note to end this section on: **treat the output as
candidates, not a kill list.** More on why, near the end.

## Question 2: What breaks if I change this? *(the `calc` case)*

The question before any refactor: if I rewrite this function, what's the full set
of code that could be affected?

Resolve the symbol to an id, then walk its callers transitively:

```bash
npx ts-knowledge-graph find run --json     # copy the id you mean
npx ts-knowledge-graph blast-radius 'MethodDeclaration:src/store/kuzu_store.ts#run@52' --depth 10
```

```
Method   run              src/cli.ts:16
Method   register         src/commands/blast_radius_command.ts:9
Method   whoCalls         src/query/graph_query.ts:29
Method   find             src/query/graph_query.ts:107
…
18 result(s)
```

`blast-radius` walks `CALLS` edges **backwards** from the target up to `--depth`
hops and returns the deduplicated set of everything that can reach it. For just
the first hop — the direct callers — there's `who-calls` (which is simply
`blast-radius --depth 1`).

This is the safety gauge for a refactor: **the smaller and more local the blast
radius, the safer the edit.** It's also how you spot inlining candidates — a
helper with exactly one caller and a tiny blast radius is begging to be folded
into its single user. That's the entire premise of the `calc` sample project:
single-use helpers the graph can point straight at.

## Question 3: Is it safe to rename or delete? *(the `shapes` case)*

`who-calls` only sees `CALLS`. But a *type* isn't called — it's used in parameter
positions, return positions, and other type definitions. To ask "what touches
this, in every sense" you need `references`:

```bash
npx ts-knowledge-graph references 'TypeAliasDeclaration:src/schema/node.ts#GraphNode@37'
```

```
<- PARAM_TYPE   load             src/store/kuzu_store.ts:29
<- PARAM_TYPE   write            src/store/jsonl_store.ts:7
<- RETURNS      getNodes         src/extract/graph_builder.ts:30
<- USES_TYPE    Extraction       src/extract/structural_extractor.ts:12
…
10 edge(s)
```

`references` reports all eight reference edge kinds and *labels each one*. For a
type like `GraphNode`, that's the precise set of declarations a breaking change to
its shape would force you to revisit: every `PARAM_TYPE` row is a function taking
it, every `RETURNS` row a function returning it, every `USES_TYPE` row a type
built on it. And the strongest signal of all: an **empty** `references` result is
the graph telling you a symbol is genuinely safe to delete. Pair it with
`dead-exports` and you have a confident answer.

The `shapes` project leans on exactly this — a method that overrides a base with
identical behavior, where `references` and `neighbors` reveal the override adds
nothing and can go.

## From answers to automation

Every query takes `--json`, returning a stable `{ id, kind, name, filePath,
startLine }` shape. That turns these from interactive commands into CI checks. Gate
a build on dead code in one line:

```bash
npx ts-knowledge-graph dead-exports --json | jq -e 'length == 0' > /dev/null \
  || { echo 'Dead exports found:'; npx ts-knowledge-graph dead-exports; exit 1; }
```

Or compute a cheap fan-in metric — how many direct callers each match for a name
has — to find the load-bearing functions in a codebase. The JSON-in/JSON-out
shape is doing quiet double duty here: the same interface a human pipes into `jq`
is the one an AI agent will consume as a tool. (That's the next post.)

## What the graph cannot see

Here's the section that matters most, because a static analyzer you trust blindly
is more dangerous than no analyzer at all. The graph is a *static* model, and its
blind spots are real:

- **Dynamic dispatch and reflection are invisible.** A method reached only through
  `obj[name]()`, a string-keyed dispatch table, or a framework that wires handlers
  by name has no `CALLS` edge. It can look dead, or show an artificially tiny blast
  radius, while being hammered at runtime.
- **Module-scope entry points look unused.** That `Cli` from Question 1 is the
  poster child: the program's actual entry point, flagged as dead because the call
  comes from module scope, not from another declaration. Always sanity-check
  `dead-exports` against how the program really starts.
- **`blast-radius` is `CALLS`-only by design.** It captures *runtime* reachability
  but says nothing about *type-checking* impact. Combine it with `references` for
  the full picture.
- **A stale graph lies confidently.** `load` merges rather than replaces, so an
  out-of-date database reports symbols that no longer exist. Re-extract before
  trusting anything you intend to act on.

None of these are bugs to be embarrassed about — they're the honest boundary of
what symbol resolution can know without running the program. Naming them is what
makes the *other* answers trustworthy. And it's also the cleanest possible
argument for the rest of this series: the way past several of these blind spots is
to stop relying on static structure alone and start feeding the graph *runtime*
truth.

## Where we are

By hand, the graph already answers the daily questions — what's dead, what breaks,
what's safe — faster and more correctly than grep, with eyes wide open about where
it can't see.

But notice that every query in this post was *driven by a human* deciding which
symbol to resolve, which traversal to run, how to read the result. What happens
when the consumer isn't a human at a terminal, but an AI agent that needs the
graph as its map of blast radius before it dares change a line? That's where we go
next.

---

*This is part 5 of **Code as a Knowledge Graph**. Next: **giving an AI agent
eyes** — the graph as JSON-in/JSON-out tools for Claude Code, and verified-safe
edits.*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
