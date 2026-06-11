---
title: 'Giving an AI Coding Agent Eyes'
subtitle: 'The code graph as JSON-in/JSON-out tools — and what it actually means to make a verified-safe edit.'
description: >-
  LLMs write code well and understand the consequences of changing existing code
  poorly. This post is about closing that gap: exposing the knowledge graph as
  tools an AI agent can call, the read-only interview that scopes a real
  optimization, and the autonomous loop that makes exactly one verified-safe edit.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - ai-agents
  - claude-code
  - llm
  - developer-tools
  - code-optimization
series: 'Code as a Knowledge Graph'
series_part: 6
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# Giving an AI Coding Agent Eyes

Every query in [the last post](./05_blast_radius_dead_code_safe_refactors.article.md)
was driven by a human: a person decided which symbol to resolve, which traversal
to run, and how to read the result. This post asks what changes when the consumer
isn't a human at a terminal but an AI agent — one that's about to edit your code.

It turns out that's exactly where a knowledge graph stops being a nice developer
convenience and becomes load-bearing.

## Why an agent needs eyes

Large language models are remarkably good at *writing* code and remarkably bad at
knowing the *consequences* of changing code that already exists. Ask one to delete
an "unused" helper and it will reach for the same tool you'd reach for — it greps,
skims a few matches, builds a fragile mental map, and acts. That was a risky habit
back in [Post 1](./01_codebase_is_a_graph.article.md) when a human did it. It's
considerably more dangerous in a machine that will confidently apply the edit.

An agent editing a real codebase is, whether it knows it or not, making a bet
about blast radius. The whole point of the graph is to replace that bet with a
lookup. As the optimization command tells the agent in its own system prompt:

> *Use the code knowledge graph as your eyes: it holds resolved symbols and types,
> so its answers about callers, references, and dead code are precise where text
> search is not. Trust it over `grep` for any question about code structure or
> impact.*

That sentence is the entire thesis of the integration. The graph is the agent's
eyes.

## The contract: JSON in, JSON out

This works because of a design choice we've been quietly setting up for four
posts. Every `GraphQuery` method returns the same flat shape, and every CLI
command takes `--json`. That uniformity was never about being tidy — it's a *tool
contract.* Each query maps one-to-one onto a tool the agent can call:

```
dead-exports   →  safe candidates to remove
find <name>    →  resolve a name to a node id (every other query needs one)
references <id> →  the decisive safety check before any change
who-calls <id> →  direct callers
blast-radius <id> →  the transitive impact set
neighbors <id> →  one-hop coupling, in and out
```

JSON in, JSON out means there's no parsing of prose, no scraping of terminal
formatting — the agent calls a tool and gets back structured truth it can act on.
The same interface a human pipes into `jq` is the one the agent consumes. Build
the boundary once, serve both.

The project ships two [Claude Code](https://claude.com/claude-code) commands built
on that contract, and they split along a sharp line: one is forbidden from
touching code, the other is allowed to — under strict discipline.

## Mode 1: the read-only interview

`/code-graph-interview` does something I find genuinely elegant: it refuses to
optimize anything until it knows *what optimization even means here.* It is the
prompt-level embodiment of [Post 2](./02_causal_knowledge_graph_vision.article.md).
It walks the user through the exact five steps from that post, in order:

1. **Dimension** — latency? memory? cost? tokens? maintainability? Don't guess —
   make the user choose.
2. **Business concern** — the pain, not the metric.
3. **Measurable target** — `800ms → 300ms`. *"If a thing cannot be measured, it
   cannot be optimized — say so."*
4. **Scope** — which part of the system.
5. **Constraints** — what must be preserved.

Then it surveys the graph for concrete candidates within that scope and presents a
ranked list of tasks — each citing real node ids, paths, and reference counts — and
*stops.* It applies nothing.

What I most want to highlight is a paragraph in its instructions about honesty,
because it's the difference between a useful agent and a confident liar:

> *For runtime dimensions (latency, memory, cost, tokens), the graph can only show
> you where in the structure a hot path lives — the user must supply the
> measurement and baseline. Say this plainly rather than inventing numbers.*

The graph *constrains* the agent to grounded claims. It can rank a symbol as a
structural hotspot by its reference and blast-radius counts — those are real graph
facts. But it cannot say "this causes 40% of your latency," because it has no
latency data, so it's told, in no uncertain terms, not to make the number up. An
agent that knows the boundary of its own knowledge is the only kind worth letting
near your codebase.

## Mode 2: the autonomous edit

`/code-graph-optimize` is the one allowed to change code — and its discipline is
the most interesting part. Its method, in order:

1. **Find a candidate.** Dead code is the safest win, so start with `dead-exports`.
2. **Confirm the blast radius.** *"Before proposing any change you MUST confirm
   safety with `references`… A symbol is safe to remove only when it has zero
   inbound references."*
3. **Read the exact text** so the edit matches precisely.
4. **Make exactly one edit.**
5. **Verify, then keep or revert.** Run `npm run typecheck`. If it passes, the edit
   stands. If it fails, `git restore` immediately — *"Never leave a failing
   type-check behind."*
6. **Stop and summarize.** One verified edit per run.

This is the opposite of "let the model rewrite the file and hope." There are two
safety rails, and they work together. *Before* the edit, the graph supplies
**grounded impact** — the agent doesn't guess who references a symbol, it asks and
gets resolved-symbol truth. *After* the edit, the typecheck is an **objective
gate** — keep on green, revert on red. One small, reversible, auditable change at a
time. The graph tells it what's safe to try; the compiler confirms it didn't break
the build.

## The honest gap (and why Post 7 exists)

Be clear about the limit, though: today the verification step is `npm run
typecheck` and nothing more. Type-correctness is not behavior-preservation, and it
is certainly not *improvement.* For dead-code removal that's largely fine — if it
still type-checks and the symbol had zero references, you've safely deleted dead
code. But the moment you target a *runtime* dimension, a green typecheck proves
nothing about latency or cost.

That's why the interview command won't invent those numbers, and it's the open
edge of the whole project. The roadmap is to run the test suite in the verify step
(catch behavior changes, not just type errors) and, for runtime work, a benchmark
harness that measures baseline → after. Until that exists, "expected −40% latency"
is a guess, and the system is honest enough to say so.

There's also a natural distribution question. Today these are slash commands
driving a CLI inside one repo. The obvious next step — tracked in the project's
issues — is an **MCP server** that exposes the graph as native agent tools, so
*any* agent, not just these two commands, can pick up the graph as eyes. Same
contract, wider reach.

## Where we are

We've gone from a graph a human queries to a graph an agent *reasons with* — using
it to scope grounded tasks and to make verified-safe edits, while being explicit
about what it cannot yet know.

And that last clause is the whole cliffhanger. The agent is only ever as good as
the truth in the graph, and today that truth is *static structure.* It knows what
calls what. It does not know what's slow, what's expensive, what actually runs in
the hot path. The final leap of this series is to fix that — to feed the graph
runtime reality and make it, at last, causal.

---

*This is part 6 of **Code as a Knowledge Graph**. Next: **making the graph
causal** — runtime enrichment, and the jump from "what connects to what" to "what
causes what."*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
