# sample_projects

Small, self-contained TypeScript projects used to exercise and test
[`ts-knowledge-graph`](../README.md). See
[issue #21](https://github.com/jeromeetienne/ts_knowledge_graph/issues/21) for
the original motivation.

Each project is deliberately written to **need optimisation**, and the kind of
optimisation differs from one project to the next. That variety is the point:
running `ts-knowledge-graph` across all three exercises a different layer of the
graph (structural / type / behavioral) and a different set of query commands.

## The projects

| Dir | Name | Stresses | Dominant optimisation | Status |
| --- | --- | --- | --- | --- |
| [`project_01`](project_01/) | `text-kit` | Structural layer — `EXPORTS`, `IMPORTS`, `READS` | Dead exports to delete (`dead-exports`) | ✅ done |
| `project_02` | `calc` | Behavioral layer — `CALLS`, `INSTANTIATES` | Single-use helpers to inline (`who-calls`, `blast-radius`) | 🚧 planned |
| `project_03` | `shapes` | Type layer — `EXTENDS`, `IMPLEMENTS`, `OVERRIDES`, `USES_TYPE` | Redundant override / over-broad interface (`references`, `neighbors`) | 🚧 planned |

Together they cover all three edge layers and every query command, and each
project also carries one *incidental* secondary optimisation so the samples stay
realistic rather than single-purpose.

## What every project contains

A common, predictable shape so the same commands work against each one:

```
project_XX/
├── README.md        # documents the planted optimisations and how to exercise them
├── package.json     # type:module — scripts: dev, test, typecheck
├── tsconfig.json    # ES2020 / NodeNext / strict, includes src + tests
├── src/
│   ├── main.ts      # non-exported main() — the runnable example, and the call-graph root
│   ├── index.ts     # public barrel
│   └── <subfolders> # the rest of the source, grouped into named folders
└── tests/           # node:test suites, run with tsx
```

Per-project scripts:

```bash
cd project_XX
npm run dev          # run src/main.ts
npm test             # npx tsx --test tests/**/*.test.ts
npm run typecheck    # tsc --noEmit
```

### A note on rooting the call graph

A leaf library has no in-graph callers of its own public API, and two things the
graph does *not* count as references would otherwise make every export look
dead:

- **barrel re-exports** (`index.ts`) are `EXPORTS` edges, not references; and
- **calls inside anonymous callbacks** (e.g. a `test('...', () => { ... })`
  body) are not captured as `CALLS` edges.

So each project roots its call graph through a **non-exported `main()`** in
`src/main.ts` that drives an internal consumer — mirroring how an application's
entry point keeps its public surface live. This is what makes a query like
`dead-exports` return *exactly* the deliberately planted orphans instead of the
whole public API.

## Exercising a project with ts-knowledge-graph

From the repository root:

```bash
npm run extract -- sample_projects/project_01 --semantic
npm run dev -- load
npm run dev -- dead-exports        # or who-calls / blast-radius / references / …
```

See each project's own `README.md` for the specific queries it is built to
demonstrate and the exact results to expect.
