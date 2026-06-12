# `verify`

Run the project's **type-check and test suite as one gate** and return a single
keep/revert verdict for an edit. This is the correctness step of the optimization
loop: a type-check proves an edit *compiles*, but it cannot see a swapped
operator, an off-by-one, or a dropped branch — those type-check fine and change
behaviour. Running the tests alongside `tsc` is what turns *"still compiles"*
into *"still works"*.

`verify` is what the `/code-graph-optimize` agent calls after it makes an edit:
one command, one JSON verdict, keep on `ok: true` and `git restore` on
`ok: false`.

Source: [`src/commands/verify_command.ts`](../../src/commands/verify_command.ts) ·
core: `ProjectVerifier.verify` in
[`src/verify/project_verifier.ts`](../../src/verify/project_verifier.ts)

## Synopsis

```bash
npx ts-knowledge-graph verify [options]
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `-C, --cwd <path>` | current directory | Project directory whose `package.json` scripts are run. |
| `--typecheck-script <name>` | `typecheck` | npm script name for the type-check gate. |
| `--test-script <name>` | `test` | npm script name for the test gate. |
| `--skip-typecheck` | `false` | Skip the type-check gate entirely. |
| `--skip-tests` | `false` | Skip the test gate (degrades to type-check-only). |
| `--json` | `false` | Emit the verdict as JSON instead of the formatted summary. |

## What it does

1. Reads `<cwd>/package.json` and looks up the `typecheck` and `test` scripts.
2. Runs each that exists, in order, as `npm run <script>`, capturing combined
   stdout + stderr.
3. Reduces the two outcomes to one verdict and prints it. The process exits
   non-zero when the verdict is not `ok`, so callers can branch on the exit code
   *or* parse the JSON.

A gate whose script is missing (or is skipped with a flag) is recorded as
`skipped`, not failed.

## The verdict

`--json` emits exactly the shape the agent consumes:

```json
{
  "ok": true,
  "behaviorVerified": false,
  "degraded": true,
  "checks": [
    { "name": "typecheck", "command": "npm run typecheck", "status": "pass", "exitCode": 0, "durationMs": 1190, "output": "…" },
    { "name": "test", "command": null, "status": "skipped", "exitCode": null, "durationMs": 0, "output": "", "skippedReason": "no \"test\" script in package.json" }
  ],
  "summary": "type-check passed, but no \"test\" script in package.json — behaviour NOT verified"
}
```

| Field | Meaning |
| --- | --- |
| `ok` | **The keep/revert bit.** `true` when at least one gate ran and no gate that ran failed. Keep the edit on `true`; revert on `false`. |
| `behaviorVerified` | `true` **only** when the test gate actually ran and passed — i.e. behaviour, not just types, was checked. |
| `degraded` | `true` when a gate was skipped (e.g. the project has no `test` script), so `ok` is a weaker statement than a full pass. |
| `checks[]` | Per-gate detail: `status` (`pass` / `fail` / `skipped`), `exitCode`, `durationMs`, and the captured `output` (tail-bounded). |
| `summary` | A one-line, quotable verdict stating exactly what was and was not verified. |

## Graceful degradation (honesty)

Not every project has a test suite. When there is no `test` script the test gate
is **skipped** rather than failed: `ok` can still be `true` (the type-check
passed), but `behaviorVerified` stays `false` and `degraded` is `true`. The
`summary` says so in words — *"behaviour NOT verified"*. The agent is instructed
to repeat that distinction in its report, so a type-check-only result is never
presented as if the change had been behaviourally tested.

## Examples

```bash
# Full gate: type-check + tests (the default the optimize agent runs).
npx ts-knowledge-graph verify --json

# Type-check only — e.g. while iterating, or on a project with no fast test suite.
npx ts-knowledge-graph verify --skip-tests

# A project that names its scripts differently.
npx ts-knowledge-graph verify --typecheck-script types --test-script spec
```

## See also

- [`/code-graph-optimize`](../../dotclaude_folder/commands/code-graph-optimize.md) — the agent that calls `verify` to keep or revert each edit.
- [`benchmark`](benchmark.md) — the *measured-impact* gate: did the edit actually make the targeted metric better? (Advisory, distinct from this hard pass/fail gate.)
