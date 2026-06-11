---
title: 'Now Let''s Actually Look at It: Visualizing a Code Graph in the Browser'
subtitle: 'A coda to the series — what you can see in a code graph that you can''t easily query, and why looking still isn''t the point.'
description: >-
  The bonus post. After six posts insisting the graph is for reasoning, not
  looking, we finally look — an interactive Cytoscape viewer served straight from
  the Kùzu database, what its clusters and hubs and islands reveal, and the honest
  place visualization holds next to querying.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - data-visualization
  - cytoscape
  - knowledge-graph
  - typescript
  - developer-tools
series: 'Code as a Knowledge Graph'
series_part: 8
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# Now Let's Actually Look at It: Visualizing a Code Graph in the Browser

A confession to open the bonus post. For seven posts I've been insisting — loudly,
in [Post 2](./02_causal_knowledge_graph_vision.article.md) especially — that *the
purpose of a knowledge graph is not visualization, it's reasoning.* I stand by
that. A pretty picture won't tell you what to optimize.

And yet. There is a real, humble value in *seeing* the thing — for building
intuition about a codebase's shape, for spotting structure your queries weren't
looking for, and, honestly, for debugging the extractor itself when an edge goes
missing. So as a coda to the series, let's drop the rigor for a moment and just
look.

> *📷 [screenshot: the full graph of this repository, nodes colored by kind]*

## One command

The graph is already sitting in a Kùzu database from
[Post 4](./04_storing_a_code_graph_in_kuzu.article.md). Serving it is one command:

```bash
npm run web
# ✓ serving the knowledge graph at http://localhost:4173/
```

Under the hood the `web` command does something pleasantly simple: it reads every
node and edge from the database *once* at startup, serializes them into a
`window.GRAPH_DATA` blob, and serves an otherwise-static page that renders them:

```ts
const nodeRows = await store.run('MATCH (n:GraphNode) RETURN n.id, n.kind, …');
const edgeRows = await store.run('MATCH (f:GraphNode)-[e:Edge]->(t:GraphNode) RETURN f.id AS from, e.kind, t.id AS to');
// → window.GRAPH_DATA = { nodes, edges };
```

The page itself is built on [Cytoscape.js](https://js.cytoscape.org/) and needs no
build step. If you don't even want the server, there are two other paths: embed
the JSONL into the page and open it from `file://`, or just drag your
`nodes.jsonl` + `edges.jsonl` straight onto the page. However the data gets there,
you end up looking at the same graph.

## Reading it with your eyes

The viewer encodes the graph's semantics into things the eye is good at:

- **Node size scales with degree** — how connected a symbol is. The big nodes are
  the load-bearing ones; the specks on the rim are leaves.
- **Edge color encodes kind** — red for `CALLS`, teal for the type edges
  (`USES_TYPE`, `RETURNS`, `PARAM_TYPE`), violet for heritage, yellow for `READS`,
  gray for structure (`CONTAINS`, `IMPORTS`).
- **Filters** let you mute kinds. Uncheck the gray structural edges and the
  behavioral core — who actually calls whom — jumps out of the noise. Flip on
  "hide isolated nodes" to drop whatever the filter just disconnected.
- **Click a node** and everything outside its neighborhood fades, while the
  sidebar lists its every incoming and outgoing edge — the same `neighbors` query
  from [Post 5](./05_blast_radius_dead_code_safe_refactors.article.md), but as a
  thing you poke at.
- **Symbol search** jumps you to a node by name.

> *📷 [screenshot: structural edges filtered off, the CALLS core highlighted]*

## What looking actually teaches you

Here's the genuine payoff, and it's the complement to the precise queries of Post
5. Some properties are awkward to *query* but instant to *see*:

- **Clusters** — tightly-interconnected blobs are your real modules, whether or not
  the directory structure agrees.
- **Hubs** — a single oversized node with edges fanning everywhere is a god object
  or a too-central utility. You'd find it with a fan-in query; you *notice* it
  without asking.
- **Islands** — a little constellation floating off on its own, connected to
  nothing, is exactly the shape of dead or orphaned code. (Cross-check with
  `dead-exports` before you celebrate — remember the module-scope entry-point trap
  from Post 5.)
- **The behavioral skeleton** — strip structural edges and the `CALLS` graph that
  remains is, quite literally, how the program flows.

This is intuition-building, and intuition is a real engineering tool. It's just a
*different* tool from the one the rest of the series was about.

## Still not the point (and that's fine)

Because here's the thing the picture can't do: it can't tell you what's slow, what
costs money, or what you should change. Squint at the prettiest force-directed
layout all day and it will not surrender a latency number. For *that* you need the
queries, and — as [Post 7](./07_making_the_graph_causal_runtime_enrichment.article.md)
argued — the runtime truth layered on top.

So the honest framing is this. **Visualization is for the human's intuition and for
sanity-checking the extractor. Reasoning is for the agent and the queries.** They
serve different masters, and a mature tool offers both without confusing one for
the other. (A planned nicety in this spirit: making each node link straight to its
source on GitHub, so the graph becomes a navigation surface and not just a
diagram.)

## Wrapping the series

That's the whole arc. We started by claiming your
[codebase is already a graph](./01_codebase_is_a_graph.article.md), made the case
that the real prize is a [causal model of its cost](./02_causal_knowledge_graph_vision.article.md),
then built it from the ground up: [parsing with ts-morph](./03_parsing_typescript_with_ts_morph.article.md),
[storing it in Kùzu](./04_storing_a_code_graph_in_kuzu.article.md),
[querying it for blast radius and dead code](./05_blast_radius_dead_code_safe_refactors.article.md),
[handing it to an AI agent](./06_giving_an_ai_agent_eyes.article.md), and
[charting the climb to runtime causality](./07_making_the_graph_causal_runtime_enrichment.article.md).
And here at the end, we finally got to see it.

The graph was never the destination. But it's a good thing to be able to look at on
the way there.

> *📷 [GIF: clicking through a few nodes, neighborhood highlighting in action]*

---

*This was the bonus post of **Code as a Knowledge Graph**. Thanks for reading.*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).
The web visualisation lives in
[`contribs/web_visualisation`](https://github.com/jeromeetienne/ts_knowledge_graph/tree/main/contribs/web_visualisation).*
