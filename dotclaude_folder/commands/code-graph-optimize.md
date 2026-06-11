---
description: Autonomously find and apply one verified-safe optimization, using the code knowledge graph as its eyes. Subscription-powered replacement for the removed `optimize` CLI command.
argument-hint: [task]
allowed-tools: Bash, Read, Edit, Skill
---

# code-graph-optimize

You are an autonomous TypeScript optimization agent working on this real codebase.
Use the code knowledge graph as your eyes: it holds resolved symbols and types, so
its answers about callers, references, and dead code are precise where text search
is not. Trust it over `grep` for any question about code structure or impact.

## Your task

$ARGUMENTS

If the task above is empty, default to this mission: **find one genuinely dead
exported symbol, confirm it has zero inbound references, then remove it safely.**

## Tools you will use

Graph queries go through this project's own CLI, which is documented by the
`code-graph-query` skill. Inside this repository's checkout, run the CLI with
`npm run dev --`, always pass `--json`, and let it use the default database at
`./outputs/graph.kuzu`:

- `npm run dev -- dead-exports --json` — exported symbols with no inbound references (the safest candidates).
- `npm run dev -- find <name> --json` — resolve a name to node id(s). Every other query needs an id; never invent one.
- `npm run dev -- references <id> --json` — everything that references a symbol or type. This is the decisive safety check.
- `npm run dev -- who-calls <id> --json` — direct callers of a function or method.
- `npm run dev -- blast-radius <id> [--depth <n>] --json` — the transitive impact set.
- `npm run dev -- neighbors <id> --json` — the one-hop neighbourhood, inbound and outbound.

If `./outputs/graph.kuzu` does not exist, build it first with
`npm run dev -- extract . --semantic` followed by `npm run dev -- load`
(the `--semantic` flag is required for caller and heritage edges).

For reading exact source text, use the Read tool. For making the change, use the
Edit tool.

## Method (follow it in order)

1. **Find a candidate.** Dead code is the safest win — call `dead-exports` first, or `find` to locate a named target from the task.
2. **Confirm the blast radius.** Before proposing any change you MUST confirm safety with `references` (and `who-calls` or `blast-radius` when useful). A symbol is safe to remove only when it has zero inbound references.
3. **Read the exact text** with the Read tool so your edit matches the file precisely.
4. **Make exactly one edit** with the Edit tool.
5. **Verify, then keep or revert.** Run `npm run typecheck`.
   - If it passes, the edit stands.
   - If it fails, revert immediately with `git restore <file>`, then either try a different edit or abandon the change. Never leave a failing type-check behind.
6. **Stop and summarize.** Report the file changed, the symbol removed, and why removal was safe. If you found no safe change, say so plainly.

## Rules

- Node ids come from `find` and `dead-exports` output; never invent them.
- Act autonomously. Do not ask the user questions — make the call yourself.
- Prefer removing genuinely dead exports or behavior-preserving simplifications. Never change observable behavior.
- Before your first edit, confirm the target file has no unrelated uncommitted changes, so that a revert restores a known-good state. If it does, mention it and proceed carefully.
- Apply at most one verified edit per run, mirroring the original optimizer's discipline.
