# `benchmark`

Measure a target node's **runtime metric** over a repeatable workload — before
and after an edit — and report the delta. Where [`verify`](verify.md) is the
*correctness* gate (a hard pass/fail: does the edit still work?), `benchmark` is
the *measured-impact* gate: did the edit actually make the targeted metric
**better**, or was *"expected −40% latency"* just a guess?

It reuses the existing runtime machinery end to end: a V8 CPU profile feeds the
same [`enrich`](enrich.md) path, and the metric is read back through the
[`cost`](cost.md) model. The one new idea is **honesty about noise** — runtime
measurement is variable, so a benchmark runs the workload N times and reports the
**median + spread**, and a baseline→after comparison is labelled **advisory**,
never a deterministic guarantee.

Source: [`src/commands/benchmark_command.ts`](../../src/commands/benchmark_command.ts) ·
core: `NodeBenchmark.measure` in
[`src/benchmark/node_benchmark.ts`](../../src/benchmark/node_benchmark.ts) ·
statistics: `BenchmarkStats` in
[`src/benchmark/benchmark_stats.ts`](../../src/benchmark/benchmark_stats.ts)

## Synopsis

```bash
npx ts-knowledge-graph benchmark <target> --workload <path> [options]
```

## Arguments

| Argument | Description |
| --- | --- |
| `<target>` | The symbol to benchmark, by **name** (e.g. `titleCase`). It is resolved against the *current* graph like [`find`](find.md), so it survives the line shifts an edit causes — you do not pass a line-bound node id. |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--workload <path>` | *(required)* | A repeatable workload entry (`.ts`/`.js`) that exercises the target under load. The project supplies it; see [Writing a workload](#writing-a-workload). |
| `-d, --db <path>` | `./outputs/graph.kuzu` | Kùzu database to read the target and its cost from. |
| `-r, --root <path>` | current directory | Project root the profile's absolute frame paths resolve against (passed to `enrich`). |
| `--by <metric>` | `self-time` | `self-time` (the node's own exclusive time), `inclusive-time` (self + everything it calls), or `samples`. |
| `--runs <n>` | `5` | Number of profiling runs to take the median of. Clamped to `[1, 50]`. |
| `--baseline <file>` | — | Compare the current median against the median saved in this file, and report the delta (advisory). |
| `--save-baseline <file>` | — | Write this run as a baseline for a later `--baseline` comparison. |
| `--json` | `false` | Emit the report as JSON. |

## What it does

1. Resolves `<target>` to exactly one node in the current graph (erroring on an
   ambiguous or missing name).
2. Repeats `--runs` times: runs the workload under `node --cpu-prof`, feeds the
   resulting profile through `enrich`, and reads the target's metric back through
   the cost model.
3. Reduces the per-run samples to a **median + spread** (`BenchmarkStats`), and —
   when `--baseline` is given — an advisory delta against the saved median.

## The report

`--json` emits exactly the shape an agent consumes:

```json
{
  "target": { "id": "Method:src/utils/string_utils.ts#titleCase@20", "name": "titleCase", "kind": "Method", "filePath": "src/utils/string_utils.ts", "startLine": 20 },
  "metric": "self-time",
  "unit": "ms",
  "stats": { "runs": 5, "median": 5326.492, "min": 5143.362, "max": 5449.927, "mean": 5309.457, "spread": 306.565, "values": [ … ] },
  "delta": { "baselineMedian": 12335.945, "currentMedian": 5326.492, "absolute": -7009.453, "percent": -0.568 },
  "advisory": "Advisory — runtime measurement is noisy. …"
}
```

| Field | Meaning |
| --- | --- |
| `stats.median` | **The headline.** The median of N runs — robust to the odd slow run in a way the mean is not. |
| `stats.spread` | `max - min`: how noisy the measurement was. A delta smaller than the spread is in the noise. |
| `delta` | Present only with `--baseline`. `absolute` and `percent` are negative when the metric went **down** (faster / fewer). `percent` is `NaN` when the baseline was 0. |
| `advisory` | The honesty note: this is a noisy median, not a guarantee, and is distinct from the hard `verify` gate. |

## Honesty about noise (advisory, not a guarantee)

The benchmark gate is deliberately **softer** than `verify`:

- `verify` is **hard**: `ok: true/false` decides keep-or-revert.
- `benchmark` is **advisory**: a median with a spread, and a delta that may or may
  not exceed that spread. The human-readable output labels a delta `improved` /
  `regressed` / `unchanged`, where `unchanged` means *the change was within the
  run-to-run spread* — i.e. indistinguishable from noise.

Treat a benchmark delta as evidence, not proof. Increase `--runs` for a tighter
read; report the spread alongside the median rather than the median alone.

## Writing a workload

A workload is a small script that exercises the target under enough load for the
sampler to catch it. The project supplies one — inferring a representative
workload is out of scope. Keep it **out of the extracted source tree** (so it
never becomes a graph node) and import the target by a module-relative path. The
bundled example, [`scripts/benchmarks/project_01_workload.ts`](../../scripts/benchmarks/project_01_workload.ts),
drives `sample_projects/project_01`:

```bash
npm run project01:benchmark
# = benchmark titleCase --workload scripts/benchmarks/project_01_workload.ts \
#     --db ./outputs/project_01/graph.kuzu --root ./sample_projects/project_01 --runs 5
```

## A before/after measurement

The metric is read against the *current* graph, so after an edit you **rebuild
the graph** (the edit shifts line numbers) before measuring again. Because
`projectNN:rebuild` wipes `./outputs/<project>`, keep the baseline file
**outside** that directory:

```bash
# 1. Baseline, before the edit (save it somewhere the rebuild won't wipe).
npm run project01:rebuild
npx ts-knowledge-graph benchmark titleCase --workload scripts/benchmarks/project_01_workload.ts \
  --db ./outputs/project_01/graph.kuzu --root ./sample_projects/project_01 \
  --save-baseline ./outputs/bench/p01_titleCase.baseline.json

# 2. Make the edit, then rebuild so node lines match the new source.
npm run project01:rebuild

# 3. After: same command with --baseline → reports the advisory delta.
npx ts-knowledge-graph benchmark titleCase --workload scripts/benchmarks/project_01_workload.ts \
  --db ./outputs/project_01/graph.kuzu --root ./sample_projects/project_01 \
  --baseline ./outputs/bench/p01_titleCase.baseline.json
```

### Worked example

`titleCase` in `sample_projects/project_01` is built from an array pipeline —
`normalizeWhitespace(value).split(' ').map(capitalize).join(' ')`. A tempting
"cleaner" rewrite collapses it to a single regex pass:

```ts
return StringUtils.normalizeWhitespace(value).replace(/(^|\s)(\S)/g, (m) => m.toUpperCase());
```

It type-checks and still passes project_01's tests, so [`verify`](verify.md)
keeps it — behaviour is preserved. But it is **~2.3× slower** (the `.replace`
callback is dearer than the array builtins here). Only the benchmark sees that.
Measuring the array-based version against the regex one (5 runs each, on the
bundled workload) settles it:

```text
titleCase  Method · src/utils/string_utils.ts:20
  self-time  median 5326.492 ms   (min 5143.362 · max 5449.927 · spread 306.565 · mean 5309.457 · 5 runs)
  Δ vs baseline  -7009.453 ms  (-56.8%)  improved
```

The array pipeline is a measured **−56.8% self-time** win over the regex — and,
read the other way, the regex is a regression that more than doubles self-time,
which the correctness gate alone would have waved through. Absolute numbers are
machine- and load-specific and drift run to run (note the ~300 ms spread), which
is exactly why the gate reports the spread and labels the delta advisory rather
than handing back a bare number.

## See also

- [`verify`](verify.md) — the hard correctness gate. Run it first: keep an edit only if it still type-checks and passes tests, *then* ask `benchmark` whether it helped.
- [`enrich`](enrich.md) / [`cost`](cost.md) — the runtime-ingest and cost-attribution machinery `benchmark` reuses to read a node's measured time.
- [`/code-graph-optimize`](../../dotclaude_folder/commands/code-graph-optimize.md) — the agent that applies an edit, verifies it, and can report its measured impact.
