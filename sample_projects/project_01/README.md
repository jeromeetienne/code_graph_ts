# project_01 — `text-kit`

A small, dependency-free string / collection utility library. It is one of three
sample projects used to exercise [`ts-knowledge-graph`](../../README.md); each
sample stresses a different layer of the graph. **`text-kit` targets the
structural layer and dead-export detection.**

## What it contains

`main.ts` and `index.ts` sit at the `src/` root; everything else is grouped into
`utils/` (the utility classes), `report/` (the consumer feature), and `shared/`
(constants and types).

| File | Exports | Role |
| --- | --- | --- |
| `src/main.ts` | — | runnable example; non-exported `main()` roots the call graph |
| `src/index.ts` | — | public barrel (re-exports the live API only) |
| `src/utils/string_utils.ts` | `StringUtils` | `capitalize`, `normalizeWhitespace`, `titleCase`, `ellipsisFor`, `truncate`, `slugify` |
| `src/utils/array_utils.ts` | `ArrayUtils` | `chunk`, `unique`, `flatten`, `groupBy` |
| `src/utils/object_utils.ts` | `ObjectUtils` | `pick`, `omit` |
| `src/utils/legacy_string_utils.ts` | `LegacyStringUtils` | superseded helpers, kept for the demo |
| `src/report/text_report.ts` | `TextReport`, `Document`, `WordStat` | internal consumer — uses the utilities from named methods |
| `src/shared/constants.ts` | `ELLIPSIS`, `DEFAULT_LOCALE` | shared constants |
| `src/shared/types.ts` | `Grouped`, `TruncateOptions`, `CaseStyle` | shared type aliases |

### Why the call graph has a root

A leaf utility library has no in-graph callers of its own public API — the real
callers are external consumers. Two things would otherwise look dead:

1. **Barrel re-exports don't count.** `index.ts` re-exporting `StringUtils` is an
   `EXPORTS` edge, which `dead-exports` does not treat as a reference.
2. **Calls inside anonymous test callbacks aren't captured.** A call to
   `StringUtils.truncate(...)` inside `test('...', () => { ... })` lives in an
   anonymous arrow function, so the extractor records no `CALLS` edge for it.

So the tests do **not** keep the public surface live. Instead the library has an
internal consumer chain — `main.ts`'s non-exported `main()` → `TextReport` → the
utility classes — exactly the way an application's entry point roots its graph.
That is what leaves only the deliberately planted orphans unreferenced.

## Planted optimisations

**Dominant — dead exports (structural layer).** Three exported symbols are
referenced by nothing in the graph:

- `LegacyStringUtils` (`src/utils/legacy_string_utils.ts`) — an orphan class,
  imported nowhere. No inbound `CALLS` / `INSTANTIATES` / `READS` edge.
- `CaseStyle` (`src/shared/types.ts`) — an unused type alias. No inbound
  `USES_TYPE` / `PARAM_TYPE` / `RETURNS` edge.
- `DEFAULT_LOCALE` (`src/shared/constants.ts`) — an unread constant. No inbound
  `READS` edge.

`dead-exports` reports exactly these three. They are safe deletions: removing
them leaves `npm run typecheck` and the test suite green.

**Incidental — a single-use helper to inline (behavioral layer).**
`StringUtils.ellipsisFor` is called only by `StringUtils.truncate`, so
`who-calls` on it returns exactly one caller — a natural inline candidate.

## Running it

```bash
# from this directory
npx tsx --test tests/**/*.test.ts   # 17 tests
npm run dev                         # the runnable example (src/main.ts)
```

## Exercising it with ts-knowledge-graph

```bash
# from the ts_knowledge_graph repo root
npm run extract -- sample_projects/project_01 --semantic
npm run dev -- load

npm run dev -- dead-exports
#   → DEFAULT_LOCALE, LegacyStringUtils, CaseStyle  (exactly three)

npm run dev -- find ellipsisFor
npm run dev -- who-calls <id>      # → exactly one caller: StringUtils.truncate
```
