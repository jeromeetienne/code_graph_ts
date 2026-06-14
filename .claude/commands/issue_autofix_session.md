---
description: Run a full overnight autofix session — loop issue_autofix over the queue, skip (never halt) on a failure or conflict, track deferrals so it cannot spin, and post a one-line-per-issue end-of-night summary. Never merges.
allowed-tools: Bash, Read, Skill
---

# issue_autofix_session

Drive one night of autofixing. Hand the oldest eligible issue to `/issue_autofix`,
record what happened, and move on — until the queue is exhausted — then summarise.
A failure or a conflict never halts the run; it is recorded and skipped.

**Nothing is ever merged.** The maintainer reviews the PRs in the morning and
merges the ones they want; each PR's `Fixes #N` closes its issue on merge. To
reject one, the maintainer closes its PR — nothing else is affected, because no
two open autofix PRs touch the same file.

Use the `gh` CLI for every GitHub interaction. Act fully autonomously. **Never
ask the user a question — not at the start, mid-run, or end.** If an issue is too
ambiguous to fix with confidence, it is recorded as failed and skipped, never
raised with the user.

## Step 1 — Preconditions

- Be on a clean `main` working tree; if it is dirty, stop and say so.
- Confirm `gh auth status` is authenticated and a push remote exists
  (`git remote -v`), since each fix ends in a pushed branch and a PR.

## Step 2 — Loop the resolver

Keep an in-memory set `deferred` of issue numbers deferred this night, starting
empty. Then repeat:

1. List eligible issues, oldest first, and pick the first one **not** already in
   `deferred`:

   ```bash
   gh issue list --state open --label autofix \
     --search '-label:autofixed -label:autofix-failed sort:created-asc' \
     --json number,title --limit 30
   ```

   If none remain (the list is empty, or every entry is already in `deferred`),
   the queue is exhausted — leave the loop.

2. Run the single-issue command for that number: `/issue_autofix <number>`.

3. Record the outcome it reports and continue — **do not stop the loop**:
   - `autofixed #N` → a PR is open and the issue is labelled `autofixed`.
   - `failed #N` → the issue is labelled `autofix-failed`.
   - `deferred #N` → add `N` to `deferred` so it is not retried tonight.

Every iteration removes one issue from consideration — it is either labelled
(`autofixed` / `autofix-failed`) or added to `deferred` — so the eligible set
always shrinks and the loop is guaranteed to terminate.

## Step 3 — End-of-night summary

Print one line per issue handled, grouped by outcome, for example:

```
Autofix session — 2026-06-14
fixed:    #12  right-align numeric columns        → <PR url>
fixed:    #15  link footer to repo                → <PR url>
deferred: #14  default output folder              (overlaps #12's PR on src/cli.ts — retry once #12 merges)
failed:   #18  support multiple languages         (npm test failed)
```

End with totals (fixed / deferred / failed) and the reminder that **nothing was
merged**: the maintainer reviews and merges the PRs, and `Fixes #N` closes each
issue on merge.

## Rules

- Skip, never halt: one stuck or conflicting issue must not end the session.
- Track deferred issues for the whole night so the loop cannot spin on the same
  conflict.
- Stay on `main` between issues; `/issue_autofix` creates and cleans up its own
  per-issue branches.
- Never merge and never close issues — the maintainer does both.
- Never ask the user a question — not at the start, mid-run, or end. Act fully
  autonomously; an ambiguous issue is recorded as failed, never raised.
