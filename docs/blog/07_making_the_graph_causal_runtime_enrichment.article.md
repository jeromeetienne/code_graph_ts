---
title: 'Making the Graph Causal: From "What Connects" to "What Costs"'
subtitle: 'Runtime enrichment — attaching latency and cost to a code graph, and propagating it into a causal model.'
description: >-
  The final post in the series. A static graph knows what calls what; it has no
  idea what's slow or expensive. This is about closing that gap: attaching runtime
  telemetry to nodes, the hard join between profiler frames and line-bound node
  ids, and propagating cost along weighted edges to finally say "this function
  causes 40% of the latency."
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - observability
  - profiling
  - knowledge-graph
  - code-optimization
  - causality
series: 'Code as a Knowledge Graph'
series_part: 7
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# Making the Graph Causal: From "What Connects" to "What Costs"

This is where the series has been heading all along.

We built a graph of TypeScript ([Post 3](./03_parsing_typescript_with_ts_morph.article.md)),
gave it a home you can traverse ([Post 4](./04_storing_a_code_graph_in_kuzu.article.md)),
used it to answer real questions ([Post 5](./05_blast_radius_dead_code_safe_refactors.article.md)),
and handed it to an AI agent as its eyes ([Post 6](./06_giving_an_ai_agent_eyes.article.md)).
Every one of those posts ended on the same quiet admission: the graph is only as
good as the truth inside it, and so far that truth is *static structure.*

A static graph knows what calls what. It has no idea what's slow, what's
expensive, or what actually runs in the hot path. Time to fix that.

## The axis a static graph is missing

Picture two functions with identical structure — same callers, same callees, same
types. In everything we've built so far, they are indistinguishable. But one is
called once at startup, and the other runs twenty thousand times a minute inside a
request handler. To a profiler they could not be more different. To our graph they
are twins.

That's the missing axis. Structure tells you what's *connected.* It cannot tell
you what's *costly.* And optimization — as [Post 2](./02_causal_knowledge_graph_vision.article.md)
argued at length — is about cost. So the leap is to attach runtime behaviour to
the nodes:

```ts
type NodeMetrics = {
	latencyMsP50: number;
	latencyMsP99: number;
	callsPerMin: number;
	cpuPct: number;
	memBytes: number;
	costPerCall: number;
	tokensPerCall: number;
	errorRate: number;
};
```

The moment those numbers live on a node, the graph stops describing *structure*
and starts describing *behaviour.* This is stage 4 of the seven-stage pipeline,
and it's the one that changes everything.

## The good news: the foundation is already poured

Here's what makes this feel within reach rather than aspirational. Two pieces of
plumbing that runtime enrichment absolutely depends on already exist, and you've
seen both.

First, **the store can hold a number.** Back in Post 4, the Kùzu schema grew a
`metadata` column on nodes and edges, round-tripped as JSON. There is, at last,
somewhere to put a latency. Without that column none of this post is possible; with
it, attaching metrics is a write, not a schema migration.

Second, **edges already carry weight.** In Post 3 the graph builder stopped
throwing away call-site multiplicity — if `A` calls `B` ten times, the `CALLS`
edge survives with `metadata.count = 10`. That count is the seed of edge *weight*,
and weight is precisely what turns a structural graph into one you can propagate
cost across.

So the question is no longer "*can* the graph become causal?" The foundations say
yes. The question is the two hard pieces of work that remain: getting the numbers
*in*, and propagating them *through.*

## Getting the numbers in: the `enrich` command

The first missing piece is ingestion — a command that reads a telemetry source and
joins it onto graph nodes. There's no shortage of sources to start from:

- **V8 CPU profiles** (`node --cpu-prof`), or `clinic` / `0x` flamegraphs — for
  CPU and self-time.
- **OpenTelemetry / OTLP spans** — which map endpoints and operations onto nodes,
  and carry latency directly.
- **Log-derived counters** — call frequency, error rate.
- **LLM-usage logs** — token cost per call site, for the dimension nobody had to
  care about five years ago.

Pick one to start — a CPU profile or OTLP spans are the natural first targets — and
the `enrich` command's job is to take its measurements and write them into the
`metadata` of the right nodes.

Which sounds simple, and is the single hardest problem in this entire post.

## The hard part: joining runtime to a line-bound id

Remember the caveat I flagged way back in Post 3, the one I promised would come
back to bite us? Node ids are **line-bound**: `MethodDeclaration:src/cart.ts#save@42`.
Profilers, meanwhile, speak in frames: a file, a function name, and a line — but
the line is wherever execution *was*, which might be a call site deep in the
function body, not the declaration's start line. So you cannot just string-match a
profiler frame against a node id. The lines won't agree.

Worse, ids shift between extractions. Edit a file, every declaration below moves,
and the stored id is now stale. So enrichment can't trust a previously-saved id
either — it has to **re-resolve** each runtime frame against the *current* graph.

The way through is the same trick that built the graph in the first place: symbol
resolution. Take a frame's file and position, ask the TypeScript compiler which
declaration encloses it — the same `resolve`-to-declaration move from Post 3 — and
*that* declaration's id is where the metric belongs. Runtime gives you a point in
the source; the compiler tells you which node owns that point. The join is a
resolution problem, not a string-matching problem, and that reframing is what
makes it tractable.

## Propagating cost: the actual causal model

Getting a latency onto a node is necessary but not sufficient. A profiler already
told you function `B` is slow. The interesting, *causal* questions are about
responsibility across the call graph:

> Function `A` itself is fast — but it calls `B` in a loop, and `B` is slow.
> *How much of the end-to-end latency is `A` responsible for?*

That's the difference between **self cost** (exclusive — time spent in the node
itself) and **inclusive cost** (self plus everything it transitively calls,
weighted by how often it calls them). Inclusive cost is a graph propagation:

```
inclusive(n) = self(n) + Σ  count(n → c) × inclusive(c)
                        over each callee c
```

Walk the `CALLS` edges, weight each by the `count` we preserved (and, once we have
it, measured frequency), and propagate a chosen metric — latency, dollars, tokens —
up the graph. Now you can attribute a *share* of the total to each node along a hot
path. And that is, finally, the sentence the whole project exists to produce:

> *This function is responsible for 40% of total latency.*

Not a hunch. A computed attribution over a weighted graph.

## What it unlocks downstream

Once cost is attributed, the "optimization surface" from Post 2 falls out as a set
of queries — and, per [Post 6](./06_giving_an_ai_agent_eyes.article.md), each one
becomes a tool the agent can call:

- **Hotspots** — top-N nodes by propagated cost, not by guesswork.
- **Leverage points** — caching candidates (high frequency, pure), batching and
  fan-out reduction, duplicate work.
- **A verify loop that finally closes.** Today the agent verifies an edit with a
  type-check, which proves nothing about speed. With runtime numbers and a
  benchmark harness, "expected −40% latency" becomes "measured −37%." The loop from
  Post 2 — *baseline → change → measure impact* — is complete.

## The whole map, honestly marked

So here is the seven-stage pipeline one last time, with an honest pin on where the
project actually stands:

```
  ① Structural extraction   ✅ built
  ② Dependency graph         ✅ built
  ③ Semantic enrichment      ⬜ code symbols only — no endpoints/services/DB yet
  ④ Runtime enrichment       ⬜ the headline work ahead (this post)
  ⑤ Knowledge-graph store    🟡 foundations in — metadata column, edge weights
  ⑥ Causal cost model        ⬜ the destination — propagation over weighted edges
  ⑦ Optimization surface     🟡 dead-code today; hotspots/leverage to come
```

There's no sleight of hand in that table. The structural and behavioural layers
are real and useful today. The causal layers are not built — but the groundwork
that the gap analysis once flagged as the *foundational blocker* (a store that
couldn't hold a number, edges that discarded their weight) is now in place. The
hard, interesting work — ingestion, the resolution-based join, propagation — is the
road from here.

## The thesis, one last time

The knowledge graph was never the goal. I said that in Post 2 and I'll close the
series on it, because the whole arc was an argument for it.

The goal is to turn a codebase into a model of its own cost — a thing you can ask
not just *what connects to what*, but *what causes what* — and then point an agent
at the one question that ever really mattered: **given this objective, what change
produces the greatest measurable improvement at the lowest risk?**

The graph is how you get there. Structure first, because it's cheap and it's the
scaffold everything else hangs on. Then semantics, then runtime, then causality,
each layer earning the next. We've built the scaffold and poured the foundation.
The causal model is what we climb toward — and it's being built in the open.

If any of this resonated, that's the best possible invitation: the issues are
where the next layers are being designed, and the next contributor might be you.

---

*This is part 7 — the finale — of **Code as a Knowledge Graph**. Thanks for
reading the whole arc, from "your codebase is already a graph" to "make it a causal
model of cost."*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
