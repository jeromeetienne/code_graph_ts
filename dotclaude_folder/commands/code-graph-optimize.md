---
description: Autonomously find and apply one verified-safe optimization, using the code knowledge graph as its eyes.
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
`npx ts-knowledge-graph`, always pass `--json`, and let it use the default database at
`./outputs/graph.kuzu`:

- `npx ts-knowledge-graph dead-exports --json` — exported symbols with no inbound references (the safest candidates).
- `npx ts-knowledge-graph find <name> --json` — resolve a name to node id(s). Every other query needs an id; never invent one.
- `npx ts-knowledge-graph references <id> --json` — everything that references a symbol or type. This is the decisive safety check.
- `npx ts-knowledge-graph who-calls <id> --json` — direct callers of a function or method.
- `npx ts-knowledge-graph blast-radius <id> [--depth <n>] --json` — the transitive impact set.
- `npx ts-knowledge-graph neighbors <id> --json` — the one-hop neighbourhood, inbound and outbound.

If `./outputs/graph.kuzu` does not exist, build it first with
`npx ts-knowledge-graph extract . --semantic` followed by `npx ts-knowledge-graph load`
(the `--semantic` flag is required for caller and heritage edges).

To verify an edit, use this project's own verify gate, which runs the
type-check **and** the test suite together and returns a single verdict:

- `npx ts-knowledge-graph verify --json` — runs the project's `typecheck` + `test` npm scripts and reports one result. `ok: true` means keep the edit; `ok: false` means revert it (the command also exits non-zero on failure). `behaviorVerified: true` means the tests actually ran and passed — not just the type-check. If the project has no `test` script the test gate is skipped, `degraded` is `true`, and the edit is type-checked only.

For reading exact source text, use the Read tool. For making the change, use the
Edit tool.

## Method (follow it in order)

1. **Find a candidate.** Dead code is the safest win — call `dead-exports` first, or `find` to locate a named target from the task.
2. **Confirm the blast radius.** Before proposing any change you MUST confirm safety with `references` (and `who-calls` or `blast-radius` when useful). A symbol is safe to remove only when it has zero inbound references.
3. **Read the exact text** with the Read tool so your edit matches the file precisely.
4. **Make exactly one edit** with the Edit tool.
5. **Verify, then keep or revert.** Run `npx ts-knowledge-graph verify --json` — one command that runs the type-check **and** the test suite, so a behaviour-changing edit (a swapped operator, an off-by-one, a dropped branch) is caught, not just a type error.
   - If `ok` is `true`, the edit stands.
   - If `ok` is `false`, revert immediately with `git restore <file>`, then either try a different edit or abandon the change. Never leave a failing verify behind.
6. **Measure the impact (optional — only when the task targets a runtime metric and a workload exists).** If the point of the edit was to make something *faster*, and the project or task supplies a repeatable workload, you can report the measured delta with `npx ts-knowledge-graph benchmark <name> --workload <path> --runs 5` (capture a `--save-baseline` before the edit, compare with `--baseline` after — rebuild the graph in between). This gate is **advisory**: a noisy median with a spread, not a pass/fail. Never present a benchmark delta as a guarantee, and never let it override the hard `verify` result.
7. **Stop and summarize.** Report the file changed, the symbol removed, and why removal was safe. State plainly **how the edit was verified**: say the change was type-checked *and* tested only when `behaviorVerified` was `true`; if verify ran `degraded` (type-check only, because the project has no test script), say the change was **not** behaviourally verified rather than implying it was. If you measured impact, report it as an advisory delta, not a promise. If you found no safe change, say so plainly.

## Rules

- Node ids come from `find` and `dead-exports` output; never invent them.
- Act autonomously. Do not ask the user questions — make the call yourself.
- Prefer removing genuinely dead exports or behavior-preserving simplifications. Never change observable behavior.
- Before your first edit, confirm the target file has no unrelated uncommitted changes, so that a revert restores a known-good state. If it does, mention it and proceed carefully.
- Apply at most one verified edit per run, mirroring the original optimizer's discipline.
