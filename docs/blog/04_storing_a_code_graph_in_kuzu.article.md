---
title: 'A Graph Deserves a Graph Database: Putting Code Into Kùzu'
subtitle: 'Why traversal wants a graph store, and the one storage decision that quietly decides the project''s future.'
description: >-
  The JSONL graph from the previous post is great for transport but terrible for
  asking questions. This post loads it into embedded Kùzu, shows why blast radius
  is trivial in Cypher and miserable in SQL, and digs into the metadata-column
  decision that determines whether the graph can ever become causal.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - graph-database
  - kuzu
  - cypher
  - static-analysis
  - typescript
series: 'Code as a Knowledge Graph'
series_part: 4
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# A Graph Deserves a Graph Database: Putting Code Into Kùzu

At the end of [Post 3](./03_parsing_typescript_with_ts_morph.article.md) we had a
graph — but only as two JSONL files, one node per line, one edge per line. That
format is wonderful for what it's for: it's diffable, streamable, and you can
load it anywhere. It is also completely useless for the thing we actually built
the graph to do, which is *ask questions about connections.*

"What are all the functions that transitively call this one, up to ten hops out?"
You are not going to answer that by reading a JSONL file. You need a thing whose
entire job is traversal. So this post is about giving the graph a real home.

## Why not just put it in SQL?

This is the obvious objection, so let's take it seriously. You could load nodes
and edges into two relational tables. Finding *direct* callers would be a simple
join. The trouble starts the moment you want *transitive* anything.

"Every function that can eventually reach `save`" is a recursive traversal of
unknown depth. In SQL that's a recursive common table expression — and every
additional hop is another self-join the planner has to reason about. It works,
but you're fighting the tool: you're expressing a graph walk in a language whose
native unit is the table row.

A graph database inverts that. Traversal is the *first-class* operation. A
variable-length path — "follow these edges between one and ten times" — is a
single clause. That's not a performance footnote; it's the difference between the
query reading like the question and the query reading like a workaround.

The project uses [Kùzu](https://kuzudb.com): an **embedded** graph database —
think SQLite, but for graphs. No server to run, it lives in a file, and it speaks
**Cypher**, the same pattern-matching query language you may know from Neo4j.

## A deliberately boring schema

Here's the entire schema — two tables:

```ts
const SCHEMA = [
	'CREATE NODE TABLE IF NOT EXISTS GraphNode (id STRING, kind STRING, name STRING, filePath STRING, exported BOOLEAN, startLine INT64, endLine INT64, metadata STRING, PRIMARY KEY (id))',
	'CREATE REL TABLE IF NOT EXISTS Edge (FROM GraphNode TO GraphNode, kind STRING, metadata STRING)',
];
```

One node table for *every* kind of node, one relationship table for *every* kind
of edge. A class and a function are both `GraphNode` rows distinguished by their
`kind` column; a `CALLS` and an `EXTENDS` are both `Edge` rows distinguished by
their `kind` property.

You could instead model each kind as its own table — a `Class` table, a `Calls`
relationship, and so on. That buys you stricter typing at the cost of a schema
that has to change every time you add a node or edge kind, and a loader and query
layer riddled with special cases. The single-table choice keeps everything
uniform: one loader path, and queries that filter by `kind` when they care and
ignore it when they don't. For a vocabulary that's still growing, uniform wins.

## Loading is an upsert

Loading walks the JSONL and `MERGE`s each record. `MERGE` is Cypher's upsert:
match-or-create. That makes the load **idempotent** — re-running it over a graph
that's already there updates in place instead of duplicating:

```ts
const nodeStmt = await this.conn.prepare(
	'MERGE (n:GraphNode {id: $id}) SET n.kind = $kind, n.name = $name, … n.metadata = $metadata',
);
// then, for edges:
const edgeStmt = await this.conn.prepare(
	'MATCH (f:GraphNode {id: $from}), (t:GraphNode {id: $to}) MERGE (f)-[e:Edge {kind: $kind}]->(t) SET e.metadata = $metadata',
);
```

One real-world wrinkle worth flagging, because it cost someone an afternoon: Kùzu
hands back native `QueryResult` objects, and if you don't close them, they get
finalized *after* the database shuts down at process exit — which crashes the
native module with a segfault. So every result is explicitly closed:

```ts
// Results left unclosed are finalized after the database shuts down at
// process exit, which crashes the kuzu native module with a segmentation fault.
private static closeResults(result: QueryResult | QueryResult[]): void {
	for (const item of Array.isArray(result) ? result : [result]) {
		item.close();
	}
}
```

Embedded databases are libraries with native bindings, not servers behind a
socket. The resource discipline is yours to keep.

## The one decision that matters: `metadata`

Look back at the schema and notice the `metadata STRING` column on *both* tables.
That column is small, and it is the most consequential design choice in the whole
store. Here's why.

Recall from Post 3 that an edge can carry data — the `count` of how many times `A`
calls `B`, for instance. And the whole vision from
[Post 2](./02_causal_knowledge_graph_vision.article.md) hinges on eventually
attaching *runtime numbers* to nodes: latency, cost, call frequency. All of that
is open-ended, growing metadata. If the store can't hold it, none of it is
possible — the graph is permanently stuck as a structural snapshot.

An early version of this schema had fixed columns only and silently dropped
`metadata` on load. That was the foundational blocker. The fix is deliberately
humble: serialize the metadata record to a JSON string and stash it in one
column.

```ts
private static encodeMetadata(metadata: Record<string, unknown> | undefined): string {
	return JSON.stringify(metadata ?? {});
}
// … and on the way out:
private static parseMetadata(value: KuzuValue): Record<string, unknown> {
	if (typeof value !== 'string' || value.length === 0) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return (typeof parsed === 'object' && parsed !== null) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}
```

Now the graph round-trips its metadata. The call-site `count` survives the trip
into the database and back out. There's somewhere to *put a number.*

I want to be honest about the limitation, because it's the seam where the next
chapter of the project lives. A JSON *string* is opaque to the query engine. You
can store `{"count": 7}`, but you can't `ORDER BY` it or filter on it in Cypher
without parsing it out in application code first. The moment we want to rank nodes
by measured latency — the actual goal — a JSON blob won't be enough; we'll want
typed columns or one of Kùzu's structured types (`MAP`/`STRUCT`). The JSON-string
column is the *cheapest correct first step*: it unblocks everything without
committing to a metrics schema we haven't designed yet. Sometimes the right
architectural move is the humble one that keeps your options open.

## Now the questions are one-liners

With the graph in Kùzu, the queries from Post 1 stop being aspirations. Direct
callers is a single pattern:

```cypher
MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode {id: $id})
WHERE e.kind = 'CALLS'
RETURN caller.id, caller.name, caller.filePath, caller.startLine
ORDER BY filePath, startLine
```

And here's the one that earns the whole graph-database choice — **blast radius**,
every symbol that transitively reaches a target by `CALLS` edges, up to a bounded
depth:

```cypher
MATCH (target:GraphNode {id: $id})<-[e:Edge*1..10 (r, n | WHERE r.kind = 'CALLS')]-(impacted:GraphNode)
RETURN DISTINCT impacted.id, impacted.name, impacted.filePath
ORDER BY filePath, startLine
```

That `*1..10` is a variable-length path: follow `CALLS` edges backward between one
and ten times, and give me everything reachable. That single clause is the
recursive-CTE-from-hell you'd have written in SQL. (The depth is clamped to a
sane `1..50` so a runaway query can't walk the entire graph.)

Every query method returns the same plain shape — id, kind, name, file, line, and
the decoded metadata record — JSON in, JSON out. That uniformity isn't an
accident either: it's what lets an AI agent consume these queries as tools, which
is exactly where this series is heading.

## Where we are

We now have the full local pipeline: source → semantic extraction → JSONL → an
embedded graph database you can actually traverse. The structural and behavioral
questions — *who calls this, what's the blast radius, what's dead* — are now cheap
to ask.

So in the next post we'll *use* it: a hands-on tour of static analysis on real
sample projects — finding dead exports to delete, single-use helpers to inline,
redundant overrides to drop — and an honest look at what this graph still can't
tell you.

---

*This is part 4 of **Code as a Knowledge Graph**. Next: **blast radius, dead
code, and safe refactors** — the graph put to work on real code.*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
