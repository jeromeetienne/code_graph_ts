---
title: 'How to Turn TypeScript Source Into a Graph (Without a Single Regex)'
subtitle: 'Building a semantic code extractor on the TypeScript Compiler API with ts-morph.'
description: >-
  The hands-on follow-up to the intro: how ts-knowledge-graph reads a TypeScript
  project the way the compiler does — resolving symbols and types — and emits a
  graph of declarations and the calls, imports, and type relationships between
  them. Real code, real caveats.
author: 'Jerome Etienne'
date: '2026-06-11'
tags:
  - typescript
  - ts-morph
  - compiler-api
  - static-analysis
  - abstract-syntax-tree
series: 'Code as a Knowledge Graph'
series_part: 3
canonical_repo: 'https://github.com/jeromeetienne/ts_knowledge_graph'
---

# How to Turn TypeScript Source Into a Graph (Without a Single Regex)

In [Post 1](./01_codebase_is_a_graph.article.md) I argued that your codebase is
already a graph, and that the questions worth asking — *who calls this, what's
dead, what breaks if I change it* — are graph traversals. In
[Post 2](./02_causal_knowledge_graph_vision.article.md) I zoomed out to the
vision: that graph is the substrate for a causal model of cost.

This post zooms all the way back in. We're going to build the thing. How do you
actually read a TypeScript project and emit a graph of its declarations and the
relationships between them? It turns out the hard part isn't the graph. It's
*resolution* — and that single problem dictates every design decision that
follows.

## Why a regex was never going to work

Say you want to find every caller of a function named `save`. The naive approach
is to grep for `save(`. You'll get hundreds of hits, and almost all of them are
wrong: a different `save` on a different object, a property called `save`, a
string that happens to contain the text. Text search sees *characters*. It has
no idea that this `save` and that `save` resolve to two completely different
declarations.

A syntax parser (Tree-sitter, Babel's parser, the raw AST) is a big step up — it
gives you real structure, a `CallExpression` node instead of a substring. But it
still can't tell you *which declaration* `save` refers to. That requires walking
imports, re-exports, inheritance, and the type system. That requires a
**symbol table and a type checker.** That requires, essentially, a compiler.

So the right foundation isn't a parser you bolt onto TypeScript. It's
TypeScript's own compiler. [`ts-morph`](https://ts-morph.com) is an ergonomic
wrapper over the TypeScript Compiler API — it gives you the same symbol and type
resolution the type-checker uses, with an API you'd actually want to write.

## Step 1: Load the project the way the build does

Before you can resolve anything, you have to load the project *with its real
configuration* — otherwise module resolution and type lookups won't match what
the compiler actually does at build time. So the loader prefers the project's own
`tsconfig.json`:

```ts
export class ProjectLoader {
	static load(rootPath: string): Project {
		const tsConfigFilePath = join(rootPath, 'tsconfig.json');
		if (existsSync(tsConfigFilePath) === true) {
			return new Project({ tsConfigFilePath });
		}
		const project = new Project();
		project.addSourceFilesAtPaths([
			join(rootPath, '**/*.ts'),
			join(rootPath, '**/*.tsx'),
			`!${join(rootPath, '**/node_modules/**')}`,
		]);
		return project;
	}
}
```

Hand it a `tsconfig.json` and you inherit the project's exact module resolution,
path aliases, and `lib` settings. No config? Fall back to globbing the source
files. Either way you end up with a `Project` whose type-checker you can now
interrogate.

## Step 2: Two passes, because not all edges cost the same

Here's the first real design decision. Some facts about your code are *cheap* —
"this file contains this class," "this file imports that module." You can read
them straight off the AST without asking the type-checker anything. Other facts
are *expensive* — "this call reaches that exact function" — because they require
symbol resolution.

So the extraction is split into two passes, and you only pay for the second when
you want it:

```ts
build(project: Project, rootPath: string, options: BuildOptions): void {
	const sourceFiles = project.getSourceFiles()
		.filter((file) => GraphBuilder.isProjectFile(file.getFilePath()));

	for (const sourceFile of sourceFiles) {
		this.merge(StructuralExtractor.extract(sourceFile, rootPath));
	}
	if (options.semantic === true) {
		for (const sourceFile of sourceFiles) {
			this.merge(SemanticExtractor.extract(sourceFile, rootPath));
		}
	}
}
```

The **structural** pass always runs and is purely syntactic. The **semantic**
pass is opt-in (`--semantic`) and is where all the resolution happens.

The structural pass is almost mechanical. For each source file, emit a `Module`
node, then walk the declarations and emit a node per class, interface, type
alias, enum, function, and variable — each with a `CONTAINS` edge back to its
parent:

```ts
for (const cls of sourceFile.getClasses()) {
	StructuralExtractor.extractClass(cls, moduleId, rootPath, nodes, edges);
}
for (const iface of sourceFile.getInterfaces()) { /* … */ }
for (const alias of sourceFile.getTypeAliases()) { /* … */ }
// functions, variables, enums, …
```

Nothing here needs the type-checker. We're just naming the things that exist.
Which raises the question every graph has to answer: *how do you name them?*

## Step 3: Give every declaration a stable address

For edges to line up, two different extractors looking at the same declaration
must compute the *same* id for it. So node ids are deterministic, derived from
the declaration itself:

```ts
export class NodeId {
	static forModule(filePath: string, rootPath: string): string {
		return `Module:${relative(rootPath, filePath)}`;
	}

	static forDeclaration(node: Node, rootPath: string): string {
		const filePath = relative(rootPath, node.getSourceFile().getFilePath());
		return `${node.getKindName()}:${filePath}#${NodeId.nameOf(node)}@${node.getStartLineNumber()}`;
	}

	static forExternalModule(specifier: string): string {
		return `External:${specifier}`;
	}
}
```

So a method ends up with an id like `MethodDeclaration:src/cart.ts#save@42`:
*kind, file, name, line.* That tuple is unique within a single extraction, and —
crucially — both the structural pass and the semantic pass derive it the same
way, so the `CONTAINS` edge from the structural pass and the `CALLS` edge from
the semantic pass point at *the same node*.

It's worth being honest about the trade-off baked into that `@42`: **ids are
line-bound.** Add a few lines at the top of a file and every declaration below
shifts down, and its id changes. That's fine within one run, but it means the
graph is a snapshot, not a stable identity you can pin durable data to across
edits. Hold that thought — it comes back to bite us when we want to attach
runtime metrics in a later post.

## Step 4: The semantic leap — `resolve()`

Everything interesting in the semantic pass funnels through one small helper, and
it is the exact thing grep can't do:

```ts
private static resolve(node: Node): Node | undefined {
	const symbol = node.getSymbol();
	if (symbol === undefined) {
		return undefined;
	}
	const resolved = symbol.getAliasedSymbol() ?? symbol;
	const declarations = resolved.getDeclarations();
	return declarations.length === 0 ? undefined : declarations[0];
}
```

Read that carefully, because it's the whole ballgame. Given any node — the
expression being called, a type reference, a `new` target — we ask the
type-checker for its **symbol**, follow `getAliasedSymbol()` to chase through
imports and re-exports to the *original* declaration, and return where it's
actually defined. `save()` no longer means "the text `save`." It means "the
declaration this name binds to, here, under TypeScript's own rules."

Watch it carry the weight in call extraction:

```ts
private static extractCalls(sourceFile: SourceFile, rootPath: string, edges: GraphEdge[]): void {
	for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		const caller = SemanticExtractor.enclosingDeclaration(call);
		if (caller === undefined) {
			continue;
		}
		const callee = SemanticExtractor.resolve(call.getExpression());
		if (callee === undefined || SemanticExtractor.inProject(callee) === false) {
			continue;
		}
		if (CALLABLE_TARGET_KINDS.has(callee.getKind()) === false) {
			continue;
		}
		edges.push(SemanticExtractor.edge(
			'CALLS',
			NodeId.forDeclaration(caller, rootPath),
			NodeId.forDeclaration(callee, rootPath),
		));
	}
}
```

For every call expression in the file: find the enclosing function or method
(that's the *caller*), resolve the thing being called to its declaration (the
*callee*), keep it only if it's defined in this project and is actually something
callable, then emit a `CALLS` edge between the two node ids. That edge is a fact,
not a guess — it's "who calls X" computed the way the compiler would.

## Step 5: Types and heritage are the same move, different node

Once you have `resolve()`, the type layer falls out of the same pattern. For a
type annotation, pull every `TypeReference` out of the type node, resolve each to
its declaration, and emit an edge — `RETURNS` for return types, `PARAM_TYPE` for
parameters, `USES_TYPE` for property and variable annotations:

```ts
private static referencedTypes(typeNode: TypeNode): Node[] {
	const references = typeNode.getDescendantsOfKind(SyntaxKind.TypeReference);
	// … resolve each reference's symbol (following aliases) to its declaration
}
```

Heritage is even more direct, because ts-morph hands it to you: `cls.getBaseClass()`
gives the `EXTENDS` target, `cls.getImplements()` the `IMPLEMENTS` targets. And
overrides take one extra step — walk up the base-class chain looking for a method
of the same name, and check implemented interfaces too:

```ts
let base = cls.getBaseClass();
while (base !== undefined) {
	const overridden = base.getMethod(name);
	if (overridden !== undefined) {
		edges.push(SemanticExtractor.edge('OVERRIDES', fromId, NodeId.forDeclaration(overridden, rootPath)));
		break;
	}
	base = base.getBaseClass();
}
```

Same engine, different question. Every edge kind is just "resolve this node, emit
an edge to where it's defined."

## Step 6: Merge — and don't throw away multiplicity

Each source file produces its own little `Extraction` of nodes and edges. The
`GraphBuilder` merges them into one graph, deduping by id. Nodes are a
straightforward last-write-wins into a `Map`. Edges are more interesting, because
if function `A` calls function `B` ten times, that's *ten* `CALLS` edges with the
*same* id — and how you handle that matters for everything downstream:

```ts
private addEdge(edge: GraphEdge): void {
	const existing = this.edges.get(edge.id);
	if (existing === undefined) {
		this.edges.set(edge.id, { ...edge, metadata: { ...edge.metadata, count: 1 } });
		return;
	}
	const current = typeof existing.metadata?.count === 'number' ? existing.metadata.count : 1;
	existing.metadata = { ...existing.metadata, count: current + 1 };
}
```

The naive thing is to collapse duplicates and move on. But notice what that
throws away: *call-site multiplicity* — the difference between calling something
once and calling it in a hot loop. So instead of discarding the repeats, we
collapse them into a single edge that carries `metadata.count`. That number is
the very first seed of edge *weight* — and weight, as Post 2 argued, is exactly
what a causal cost model needs. It's a tiny detail with a long reach.

## The boundary: what's "in the project"

A recurring guard you'll have spotted is `inProject()`:

```ts
private static inProject(node: Node): boolean {
	const sourceFile = node.getSourceFile();
	return sourceFile.getFilePath().includes('/node_modules/') === false
		&& sourceFile.isDeclarationFile() === false;
}
```

The graph is about *your* code. Calls into `lodash` or `node:fs` don't resolve to
declarations worth graphing, so they're filtered out. Imports of external
packages collapse to a single `ExternalModule` node per specifier — enough to
know a dependency exists, without dragging all of `node_modules` into the graph.
That's a deliberate boundary, and (foreshadowing again) it's exactly the boundary
a future *semantic enrichment* layer would push on, when external services and
APIs become first-class nodes.

## The payoff

Point the extractor at a project and ask for the full graph:

```bash
npm run extract -- ./my-project --semantic
```

Out come two JSONL files — one node per line, one edge per line:

```jsonc
// nodes.jsonl
{ "id": "Class:src/cart.ts#Cart@8", "kind": "Class", "name": "Cart", "filePath": "src/cart.ts", "exported": true }

// edges.jsonl
{ "id": "CALLS:…#checkout@20->…#save@42", "kind": "CALLS", "from": "…checkout@20", "to": "…save@42", "metadata": { "count": 3 } }
```

Plain, diffable, boring on purpose — and now we have a real graph of declarations
and the verified relationships between them.

But JSONL isn't where you *ask questions*. To traverse this thing — to compute a
blast radius or find dead code — you want it in a graph database. That's the next
post: loading the graph into embedded Kùzu, and the surprisingly load-bearing
decision of how to store an edge's metadata.

---

*This is part 3 of **Code as a Knowledge Graph**. Next: **storing a code graph in
Kùzu** — why a graph database, and the fixed-columns-vs-open-metadata choice that
quietly decides what the whole project can become.*

*`ts-knowledge-graph` is open source:
[github.com/jeromeetienne/ts_knowledge_graph](https://github.com/jeromeetienne/ts_knowledge_graph).*
