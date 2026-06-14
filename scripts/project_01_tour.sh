#!/usr/bin/env bash
#
# Exercise every ts-knowledge-graph query tool against sample_projects/project_01.
#
# Builds the graph from scratch, then runs find / who-calls / calls / references /
# neighbors / blast-radius / dead-exports against real symbols in the project so
# each tool returns a meaningful, non-empty result, then enriches with a live CPU
# profile, ranks hotspots by measured self-time, and propagates that into
# inclusive cost with per-node causal attribution (cost). It closes on the two
# optimize-loop gates: verify (the hard type-check + test correctness gate) and
# benchmark (the advisory measured-impact gate, median + spread over N runs).
#
# Usage:  npm run project01:tour       (or)  bash scripts/project_01_tour.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT='sample_projects/project_01'
OUT='./outputs/project_01'
CLI='npx tsx src/cli.ts'

# Resolve a declaration to its node id by EXACT name (find itself is a fuzzy,
# case-insensitive substring matcher, so "StringUtils" would also match
# "LegacyStringUtils"). Optional second argument filters by node kind.
idof() {
	$CLI find "$1" -o "$OUT" --json 2>/dev/null \
		| node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const l=Array.isArray(r)?r:(r.results||[]);const n=process.argv[1],k=process.argv[2];const m=l.find(x=>x.name===n&&(k?x.kind===k:true));if(!m){process.stderr.write("no node named "+n+(k?" of kind "+k:"")+"\n");process.exit(1);}process.stdout.write(m.id);' "$1" "${2:-}"
}

section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

section 'rebuild the graph from scratch (clean → extract → load)'
rm -rf ./outputs/project_01/graph ./outputs/project_01/graph.kuzu ./outputs/project_01/prof
$CLI extract "$PROJECT/src" --semantic -o "$OUT"
$CLI load -o "$OUT"

section 'dead-exports — the three planted orphans (no id needed)'
$CLI dead-exports -o "$OUT"

section 'find — resolve a name to node ids (fuzzy: matches the type and the method)'
$CLI find truncate -o "$OUT"

section 'who-calls normalizeWhitespace — direct callers (expect 4)'
$CLI who-calls "$(idof normalizeWhitespace)" -o "$OUT"

section 'calls headline — what TextReport.headline calls directly (expect 3)'
$CLI calls "$(idof headline)" -o "$OUT"

section 'references Document — every reference to the type (PARAM_TYPE / RETURNS)'
$CLI references "$(idof Document TypeAlias)" -o "$OUT"

section 'neighbors StringUtils — one-hop neighbourhood, in and out (CONTAINS + READS)'
$CLI neighbors "$(idof StringUtils Class)" -o "$OUT"

section 'blast-radius normalizeWhitespace — transitive impact set up to main()'
$CLI blast-radius "$(idof normalizeWhitespace)" -o "$OUT" --depth 10

section 'cluster — group symbols into modules with the Leiden algorithm; the community index rides metadata.community (no schema change)'
$CLI cluster -o "$OUT"

section 'enrich — attach measured runtime metrics from a live V8 CPU profile'
bash "$ROOT/scripts/profile_and_enrich.sh" project_01

section 'find titleCase --json — the measured metrics now ride metadata.runtime (no schema change)'
$CLI find titleCase -o "$OUT" --json

section 'hotspots — rank the whole graph by measured self-time (what enrich just unlocked)'
$CLI hotspots -o "$OUT" --by self-time

section 'cost — propagate self-time into inclusive cost, ranking by share of total (the causal view)'
$CLI cost -o "$OUT"

section 'cost titleCase — where its inclusive cost goes (callees) and who is responsible for it (callers)'
$CLI cost "$(idof titleCase Method)" -o "$OUT"

section 'verify — the optimize loop’s hard correctness gate: this project’s type-check + tests as one keep/revert verdict'
$CLI verify --cwd "$PROJECT"

section 'benchmark titleCase — the advisory measured-impact gate: self-time over 3 runs (median + spread) on a fixed workload'
$CLI benchmark titleCase --workload "$ROOT/scripts/benchmarks/project_01_workload.ts" --root "$PROJECT" -o "$OUT" --runs 3

section 'report — write the CODEBASE_BRIEF, one shareable snapshot of everything above'
$CLI report -o "$OUT"

section 'done'
printf 'Interactive: explore the same graph in the browser with\n  npm run project01:webview\n'
