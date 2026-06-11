---
title: 'Your TypeScript Codebase Is Already a Graph (You Just Can''t See It Yet)'
subtitle: 'Why the questions we ask before touching code are graph questions — and what happens when you make that graph real.'
description: >-
  Every codebase is a graph of calls, imports, and types. We keep it locked in
  our heads and squint at it through grep. This is the story of making that
  graph explicit and queryable for TypeScript — the first post in a series on
  ts-knowledge-graph.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - typescript
  - knowledge-graph
  - static-analysis
  - developer-tools
  - ai-agents
series: 'Code as a Knowledge Graph'
series_part: 1
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# Your TypeScript Codebase Is Already a Graph (You Just Can't See It Yet)

You're about to change a function. Before your fingers hit the keyboard, a small
voice asks the question every engineer has asked ten thousand times:

> *If I touch this, what breaks?*

So you reach for the tool that's always within reach — you grep. You search the
name, you skim the matches, you open a few files, you build a fragile little map
in your head, and you hope you didn't miss the one caller that mattered. Then you
make the change and find out at runtime, or in review, or in production, whether
your mental map was right.

We do this constantly. And it's strange, because the information we need is
*already there*, sitting in the code in a far richer form than grep can see. We
just keep flattening it into text and searching the text.

This is a series about not doing that anymore. About taking the structure that's
already latent in a TypeScript codebase and making it **explicit, queryable, and
honest** — a knowledge graph. This first post is about *why* that's the right
shape for the problem. The how-we-built-it comes later.

## Code isn't text. We just store it that way.

Here's the thing grep can't know: in your codebase, a function calls another
function. A module imports another module. A class extends a base class and
implements an interface. A type flows into a parameter, out of a return, through
a dozen call sites. None of those are textual facts. They're *relationships* —
directed, typed, and meaningful.

Lay them out and you don't get a list. You get a graph.

```
         imports                 calls                 extends
Module ───────────▶ Module   Function ──────▶ Function   Class ──────▶ Class
   │                              │                          │
   │ contains                     │ uses-type                │ implements
   ▼                              ▼                          ▼
 Class                          TypeAlias                 Interface
```

Nodes are the *things* in your code — modules, classes, interfaces, type
aliases, enums, functions, methods, properties, parameters, variables. Edges are
the *relationships* between them, and they come in layers:

- **Structural** — what contains what, what imports what, what's exported.
- **Type** — what extends or implements what, what uses a type, what a function
  returns and takes as parameters.
- **Behavioral** — what calls what, what gets instantiated, what overrides what,
  what reads and writes what.

You already navigate this graph every day. "Go to definition" walks one edge.
"Find all references" fans out one hop. The graph is real and you're already
using it — you've just never been allowed to *hold the whole thing in your hand
and ask it questions.*

## The questions we actually ask are graph traversals

Look closely at the questions that come up right before you change code, and a
pattern jumps out. They're not text searches. They're graph walks.

**"What breaks if I change this?"** — That's not "where does this name appear."
It's "follow every `calls` edge backwards, transitively, and show me the set of
things that ultimately depend on this." In the project I'll introduce in a
moment, that's a single query called **blast radius**.

**"Can I delete this? Is it dead?"** — That's "does any inbound edge reach this
symbol — a call, a type use, an import, anything?" If nothing points at it, it's
dead. That's **dead-exports**.

**"What's affected if I change this type?"** — Follow the type edges:
`uses-type`, `param-type`, `returns`, `extends`, `implements`. That's a
**references** query.

Every one of these is a question about *connections*. And a graph is the one data
structure whose entire reason for existing is to answer questions about
connections. Trying to answer them with grep is like trying to navigate a subway
system by reading every station sign in alphabetical order. The information is
all present; the *shape* is all wrong.

## Why grep was never going to be enough

It's tempting to think you could get most of the way there with a clever enough
regular expression. You can't, and the reason is worth dwelling on, because it's
the reason the whole project exists.

Grep — and any syntax-only parser — sees *shapes of text*. It sees the word
`save`. It does not know that the `save` you're calling here is the method on
*this* class, defined in *that* file, and not the unrelated `save` from some
other module that happens to share a name. It sees `process` and has no idea
whether you mean Node's global, a local variable, or an imported function.

Answering "who calls *this exact symbol*" requires **semantic** understanding:
resolving each name to the actual declaration it refers to, following the type
system, understanding imports and re-exports and inheritance. That's not a
parsing problem you bolt on with a regex. It's the same work a compiler does.

Which is exactly why the right foundation for a code knowledge graph is the
compiler itself. For TypeScript, that means the TypeScript Compiler API (the
project uses [`ts-morph`](https://ts-morph.com) as a friendly wrapper over it).
The graph isn't an approximation of your code's meaning. It's read straight out
of the same engine that type-checks it.

## What it looks like when the graph is real

So I built [`ts-knowledge-graph`](https://github.com/jeromeetienne/ts_knowledge_graph):
point it at a TypeScript project, and it parses the source into a graph.

The output is deliberately boring — two files, one node per line, one edge per
line, plain JSONL you can read, diff, and load anywhere:

```
nodes.jsonl   →  every module, class, function, type, …
edges.jsonl   →  every call, import, extends, uses-type, …
```

Load that into an embedded graph database and the questions from earlier stop
being archaeology and become one-liners:

```bash
who-calls   <symbol>     # direct callers
blast-radius <symbol>    # everything transitively impacted — the real answer to "what breaks?"
dead-exports             # exported symbols nothing references
references  <symbol>     # every call, type use, heritage link, instantiation
```

And here's the detail I'm quietly proud of, because it's where "looks like it
works" and "actually works" part ways: `dead-exports` is **member-aware**. A
class counts as alive if *any* of its members is used, and it weighs calls, type
usage, inheritance, instantiation, and value reads all together. Run it on this
very repository and it reports exactly the two genuinely-unused type aliases —
no false positives, nothing you'd have to second-guess. A graph that cries wolf
is a graph you stop trusting. This one doesn't.

## This is the floor, not the ceiling

If the story ended at "a really good find-references," it would be a nice tool
and not much of a series.

But notice what we've actually built: a *substrate*. Once your codebase is a
graph, blast radius isn't something you reconstruct in your head under deadline
pressure — it's a map. And a map is exactly what you need to hand to an AI agent
so it can reason about a change before making it: *who calls this, what depends
on it, is this safe to touch.*

That's the direction this whole project is pointed. The graph of structure and
types is **stage one**. The real ambition — the subject of the next post — is to
keep enriching that graph until it becomes something much more powerful: a
**causal model of your system's cost.** Not just "function A calls function B,"
but "function A is *where 40% of your latency comes from*," "this query is *what
spikes the bill*." A graph you can ask not only *what connects to what*, but
*what causes what* — and therefore, *what to optimize.*

We'll get there one layer at a time. But it starts here, with a simple, slightly
subversive idea:

> Your codebase was a graph all along. You've just been reading it as a wall of
> text. Let's make it something you can ask questions of.

---

*This is part 1 of **Code as a Knowledge Graph**. Next up: **Towards a causal
knowledge graph for code optimization** — what "optimize" actually means, and why
the knowledge graph is the* culmination *of the analysis, not the starting point.*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).
If the idea resonates, a star helps — and the issues are where the vision is
being worked out in the open.*
