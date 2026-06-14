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

## Two task classes (they have different success gates)

Decide which class the task is before you start — the two are held to different
proof, and you may only claim what you can prove:

- **Behavior-preserving** — dead-code removal, or an equivalent rewrite /
  simplification whose outputs are identical. Success gate: **`verify` alone**
  (type-check + tests). The claim you earn is "applied safely, behavior unchanged"
  — never a speed claim, because `verify` proves *no regression*, not *improvement*.
- **Runtime-improvement** — the whole point of the edit is to make the target
  *faster* (or use fewer samples). Success gate: **`verify` AND a measured
  `benchmark` delta** against a saved baseline. Without an `improved` delta you
  have **not** optimized anything — say so, and never dress an unmeasured or
  within-noise change up as a win.

If a runtime-improvement task has no repeatable workload to benchmark against, you
cannot prove the improvement: either downgrade it to a behavior-preserving change
and claim only that, or stop and report that a workload is required.

## Tools you will use

Graph queries go through this project's own CLI, which is documented by the
`code-graph-query` skill. In the project you are optimizing, run the CLI with
`npx ts-knowledge-graph`, always pass `--json`, and let it use the default database at
`./.ts_knowledge_graph/graph.kuzu` (when running inside the ts-knowledge-graph
repository itself, substitute `npm run dev --`):

- `npx ts-knowledge-graph dead-exports --json` — exported symbols with no inbound references (the safest candidates).
- `npx ts-knowledge-graph find <name> --json` — resolve a name to node id(s). Every other query needs an id; never invent one.
- `npx ts-knowledge-graph references <id> --json` — everything that references a symbol or type. This is the decisive safety check.
- `npx ts-knowledge-graph who-calls <id> --json` — direct callers of a function or method.
- `npx ts-knowledge-graph blast-radius <id> [--depth <n>] --json` — the transitive impact set.
- `npx ts-knowledge-graph neighbors <id> --json` — the one-hop neighbourhood, inbound and outbound.

When the task targets execution time, locate the hot symbol from measured data
rather than guessing: profile the project (`node --cpu-prof` writes a `.cpuprofile`),
`enrich` the graph, then rank:

- `npx ts-knowledge-graph enrich <profile>.cpuprofile --root <project-root> --json` — attach measured self-time + `CALLS_RUNTIME` edges.
- `npx ts-knowledge-graph hotspots --by self-time --json` — the leaves where execution time is actually spent (falls back to static fan-in when not enriched).
- `npx ts-knowledge-graph cost --json` — inclusive runtime cost by share of total.

If `./.ts_knowledge_graph/graph.kuzu` does not exist, build it first with
`npx ts-knowledge-graph extract . --semantic` followed by `npx ts-knowledge-graph load`
(the `--semantic` flag is required for caller and heritage edges).

To verify an edit, use this project's own verify gate, which runs the
type-check **and** the test suite together and returns a single verdict:

- `npx ts-knowledge-graph verify --json` — runs the project's `typecheck` + `test` npm scripts and reports one result. `ok: true` means keep the edit; `ok: false` means revert it (the command also exits non-zero on failure). `behaviorVerified: true` means the tests actually ran and passed — not just the type-check. If the project has no `test` script the test gate is skipped, `degraded` is `true`, and the edit is type-checked only.

To prove a runtime-improvement — and only then — use the benchmark gate, which
re-profiles a repeatable workload and compares medians:

- `npx ts-knowledge-graph benchmark <name> --workload <path> [--by self-time] --runs 5 --save-baseline --json` — measure and save the before-baseline for `<name>` (a symbol name, resolved like `find`).
- `npx ts-knowledge-graph benchmark <name> --workload <path> --runs 5 --baseline --json` — re-measure after the edit and emit a `delta` classified `improved` / `unchanged` / `regressed`. A change within the run-to-run spread reads as `unchanged`. Advisory: a noisy median, never a guarantee.

For reading exact source text, use the Read tool. For making the change, use the
Edit tool.

## Method (follow it in order)

1. **Find a candidate.** If the task names a target, `find` it. If the task targets execution time, `enrich` the graph from a CPU profile and rank with `hotspots` / `cost` to locate the hottest symbol. With no task given, dead code is the safest win — call `dead-exports` first.
2. **Confirm and bound the blast radius.** Before any change you MUST map who depends on the target with `references`, `who-calls`, and `blast-radius`. Two shapes are safe to apply autonomously:
   - **Removal / internal change** — safe when the change does not touch the symbol's contract: a removal needs **zero inbound references**; an internal-only rewrite (same signature, same outputs) needs no call-site edits at all, so `references` / `blast-radius` only tell you who is at risk and `verify` is the gate.
   - **Coordinated interface change** — when the change *does* touch the contract (a rename, a signature tweak, a moved symbol), it is safe only when you can **enumerate the complete caller / reference set** (`who-calls` + `references`) and that set is **small enough to update in one coherent pass** (a low blast radius). The graph sees only *in-project* references: an interface change to a symbol external code may import (a package entry point or otherwise published export) has an **unbounded** blast radius — treat it as out of autonomous scope. If `blast-radius` returns a large or sprawling impact set, do not attempt it autonomously — downgrade the task or stop. Use `cluster` to check the change stays within one module community; a refactor that ripples across community boundaries is too coupled for one run.
3. **Read the exact text** with the Read tool so your edit matches the file precisely.
4. **Apply one coordinated change** with the Edit tool. This is **one optimization**, not necessarily one Edit call: a coordinated interface change updates the target *and* every call site you enumerated in step 2, so it may be several Edit calls across several files — but it stays a single, behavior-preserving logical change, and touches nothing outside the enumerated set. For a **runtime-improvement** task, first capture the before-baseline while the code is still unedited:
   `npx ts-knowledge-graph benchmark <name> --workload <path> --runs 5 --save-baseline --json`.
5. **Verify, then keep or revert (correctness gate — both classes).** Run
   `npx ts-knowledge-graph verify --json`: it runs the type-check **and** the test
   suite, so a behaviour-changing edit (a swapped operator, an off-by-one, a dropped
   branch) is caught, not just a type error.
   - If `ok` is `false`, revert the **entire** change immediately — `git restore` every file you touched (the target and all updated call sites) — then either try a different change or abandon it. A coordinated change reverts as a whole; never leave a half-applied edit or a failing verify behind.
   - If `ok` is `true`, the edit is *safe*. Whether you may call it an *optimization* depends on its class (step 6).
6. **Prove the improvement (runtime-improvement tasks only — required, not optional).**
   Re-measure against the baseline you saved in step 4:
   `npx ts-knowledge-graph benchmark <name> --workload <path> --runs 5 --baseline --json`,
   and read the `delta` direction the command reports:
   - `improved` (the median dropped by more than the run-to-run spread) — keep the edit and report the measured delta.
   - `unchanged` (within noise) — you did **not** measurably optimize anything. Revert, unless the edit stands on its own as a behavior-preserving cleanup, in which case keep it but make only that claim.
   - `regressed` (it got slower) — revert immediately.
   The benchmark is statistically advisory (a noisy median + spread), so never present the delta as a guarantee — but for a runtime task a measured `improved` delta is the *only* thing that earns the word "optimized". A behavior-preserving task skips this step (it never made a speed claim).
7. **Stop and summarize — claim only what a gate proved.** Report the file changed
   and what you did. State the verification precisely:
   - Behavior-preserving: "type-checked and tested" only when `behaviorVerified` was `true`; if verify ran `degraded` (type-check only, no test script), say the change was **not** behaviourally verified rather than implying it was.
   - Runtime-improvement: give the measured before→after median and the `improved` / `unchanged` / `regressed` verdict; never claim a speed-up you did not measure.
   If you found no safe-and-proven change, say so plainly.

## Rules

- Node ids come from `find`, `dead-exports`, and `hotspots` / `cost` output; never invent them. `benchmark` resolves a symbol *name* like `find`.
- Act autonomously. Do not ask the user questions — make the call yourself. The one exception: if the task is a runtime-improvement that needs a benchmark workload and none is supplied or discoverable, stop and report that rather than claiming an unmeasured win.
- Honor the task's **executor-readiness** when the interview supplied one: `auto-applicable` you may apply and verify; `needs-workload` requires a benchmark workload before you can claim improvement; `manual` is out of autonomous scope — explain why and stop.
- Preserve observable behavior — identical outputs, same API contract. A runtime-improvement is a behavior-*preserving* change to the implementation (memoization, an equivalent lower-complexity rewrite, batching), never a change to what the code returns.
- Claim only what a gate proved: `verify` earns "safe / behavior unchanged"; only a measured `improved` benchmark delta earns "optimized / faster".
- Before your first edit, confirm the working tree is clean across the files your change will touch (the target and its call sites), so that a whole-change revert restores a known-good state. If there are unrelated uncommitted changes there, mention it and proceed carefully.
- Apply at most one verified optimization per run — a single behavior-preserving logical change, even when it spans several call sites within its enumerated blast radius. Do not bundle unrelated changes.
- Stay inside the blast radius you enumerated and verified. If applying the change correctly would require touching sites you did not enumerate, stop — your impact map was incomplete.
