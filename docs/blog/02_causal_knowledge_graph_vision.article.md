---
title: 'What Does It Actually Mean to "Optimize" Code?'
subtitle: 'The knowledge graph is the last step, not the first — towards a causal model of cost.'
description: >-
  "Optimize" is a word that means nothing until you say what you're trading and
  what you're measuring. This is the vision behind ts-knowledge-graph: turning a
  codebase, layer by layer, into a causal model of its own cost — and why the
  knowledge graph is the culmination of that analysis, not the starting point.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - code-optimization
  - knowledge-graph
  - software-architecture
  - ai-agents
  - causality
series: 'Code as a Knowledge Graph'
series_part: 2
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# What Does It Actually Mean to "Optimize" Code?

In the [first post](./01_codebase_is_a_graph.article.md) I made a small claim:
your codebase is already a graph, and the questions you ask before changing code
— *what breaks, what's dead, what's affected* — are graph traversals. Making that
graph explicit turns archaeology into one-line queries.

That post ended on a promise. The point of all this isn't a nicer
"find references." It's to keep enriching the graph until it becomes something
much more ambitious: a **causal model of your system's cost.** This post is about
what that means and why it's the right north star.

Let me start somewhere unexpected — with a word I think is quietly broken.

## "Optimize" is a trap

A stakeholder walks over and says: *"Can you optimize this?"*

It feels like a clear request. It is not. *Optimize* is one of those words that
sounds technical but carries almost no information until you pin down two things:
**what you're trading, and what you're measuring.**

Because optimization is multi-dimensional, and the dimensions pull against each
other:

- **Execution time** — latency, throughput, CPU cycles
- **Memory** — peak and average footprint, allocation count
- **Infrastructure cost** — the cloud bill, API calls, *LLM tokens*
- **Network** — requests, bytes on the wire, cache hit ratio
- **Scalability** — concurrent users, queue depth, bottlenecks
- **Maintainability** — complexity, coupling, change surface (the most expensive
  one, long-term)
- **Bundle / binary size**, **energy consumption**, and more

Make it faster and you might use more memory. Cut the cloud bill and you might
hurt latency. Simplify for maintainability and you might give up a hand-tuned hot
path. There is no "optimized" in the abstract — only optimized *for something, at
the expense of something else.*

So the first act of optimization isn't technical at all. It's choosing the axis.

## It starts with a business problem, not a metric

Here's the mistake almost everyone makes, myself included: we start with the
technical metric. "Let's reduce CPU." "Let's add a cache."

But the metric is downstream of a pain someone actually feels. The honest chain
runs the other way:

| Business concern | → | Technical goal |
|---|---|---|
| Cloud bill too high | → | reduce CPU / memory / storage |
| Users say it's slow | → | reduce latency |
| Hitting API rate limits | → | reduce outbound requests |
| Database is overloaded | → | reduce queries per request |
| Mobile app keeps crashing | → | reduce memory |
| LLM costs are exploding | → | reduce token usage |

The customer understands the *pain*, rarely the implementation. The work of
optimization is translating a felt problem into a measurable target — and then
proving you moved it.

Which brings us to the part everyone skips.

## If you can't measure it, you can't optimize it

Compare two objectives:

> ❌ *Make the application faster.*

> ✅ *Reduce average response time on `GET /search` from 800ms to 300ms.*

The first is a vibe. The second is an engineering task. It has a number, a
target, and a scope. You can tell, afterward, whether you succeeded.

That demands three unglamorous things *before* you change a single line:

1. **A measurable target** — `800ms → 300ms`, `50 queries → 10`, `10M tokens/day → 2M`.
2. **A baseline** — measure current behaviour first, or "improvement" is a story
   you tell yourself.
3. **Constraints** — the properties the optimization must *not* break: same
   functionality, same API contract, same security guarantees, same UX. Most
   failed optimizations don't fail because they didn't speed things up. They fail
   because they quietly broke a constraint.

None of this is exotic. But notice that we've gone several layers deep into
"optimize code" and haven't talked about code yet. That's the point.

## So where does the knowledge graph come in?

Here's the twist, and it's the thing I most want this series to land.

When people hear "we'll analyze the codebase to find what to optimize," they
reach for a graph or a visualizer *first*. Parse the repo, draw the boxes and
arrows, look for the obvious mess.

That's backwards. **A knowledge graph is not the first step. It's the last.** It
is the *result* of stacking several layers of analysis on top of each other —
and only the full stack can answer the question that actually matters.

Think of it as a pipeline where each stage adds a kind of meaning the previous
one couldn't express:

```
  Repository
      │
      ▼
  ① Structural extraction   ── what exists?      (files, modules, classes, functions)
      │
      ▼
  ② Dependency graph        ── what connects?    (A imports B, X calls Y)
      │
      ▼
  ③ Semantic enrichment     ── what does it mean? (endpoints, services, DB tables,
      │                                            queues, caches, config flags)
      ▼
  ④ Runtime enrichment      ── how does it behave? (latency, CPU, memory, frequency,
      │                                             cost, error rate — per node)
      ▼
  ⑤ Knowledge graph         ── structure + semantics + runtime + business metadata
      │
      ▼
  ⑥ Causal model            ── what CAUSES the cost?
      │
      ▼
  ⑦ Optimization surface    ── hotspots + leverage points → what to change
```

Stage ① and ② are where [Post 1](./01_codebase_is_a_graph.article.md) lives:
*what exists* and *what connects*. Useful — blast radius and dead code already
fall out of it. But it's still a **structural** picture. It can tell you that
`calculatePrice` is called from forty places. It cannot tell you that
`calculatePrice` is *where 40% of your latency comes from.*

Stage ③ adds the system's real vocabulary — not just "function" and "class," but
*endpoint, service, database table, queue topic, cache key, external API.* The
graph stops describing code and starts describing the *system.*

Stage ④ is the one that changes everything. You attach runtime behaviour to the
nodes: this function runs 20,000 times a minute at 240ms each and costs
$0.02 a call. Now the graph isn't structure anymore. It's **behaviour.**

## The real goal is causality

Stack all of that — structure, semantics, runtime, plus business metadata like
ownership, SLOs, and risk — and you get a knowledge graph whose purpose is not to
be *looked at.* Visualization is a side effect. The purpose is to **reason.**

And the specific kind of reasoning is causal. Not "these things are connected,"
but statements like:

> *This function causes 40% of total latency.*
>
> *This service is responsible for 70% of outbound requests.*
>
> *This one query causes the cost spikes.*
>
> *This API call dominates token spend.*

That's the whole ballgame. Optimization, done well, is **causal analysis** — and
the deliverable isn't a diagram, it's an answer to a single question:

> *Given a specific optimization objective, what change produces the greatest
> measurable improvement at the lowest risk?*

A graph that can answer *that* is worth building. A graph you merely admire is not.

## Where the project actually is (and isn't)

I want to be honest about the gap, because the honesty is the credibility.

Today, `ts-knowledge-graph` implements roughly **stages ① and ②**, plus a
semantic layer for *code symbols* (calls, types, heritage) and an AI agent at
both ends that uses the graph to make verified-safe edits. That's real, and it's
genuinely useful for the **maintainability** dimension — dead code, blast radius,
safe refactors.

Everything that makes the graph *causal* — runtime enrichment, a store that can
actually hold the numbers, edge weights that survive instead of being deduped
away, cost propagation along hot paths — is still ahead. I've written up exactly
what's missing, grounded in the current code, in the project's gap-analysis
issue, so the roadmap is concrete rather than aspirational.

That's the journey this series follows. The next posts go down into the layers
that already exist — how the TypeScript Compiler API turns source into semantic
edges, how the graph lives in an embedded database, how blast radius and
dead-code detection work in practice — and then climb back up toward the layers
that don't exist yet: runtime enrichment, and the causal model that is the actual
destination.

The knowledge graph was never the goal. It's the substrate. The goal is to turn a
codebase into a model of its own cost — and then ask it the only question that
ever really mattered: *what should we change?*

---

*This is part 2 of **Code as a Knowledge Graph**. Next: we get our hands dirty —
**parsing TypeScript with `ts-morph`**, and why a regex was never going to cut it.*

*`ts-knowledge-graph` is open source and the vision is being worked out in the
open:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
