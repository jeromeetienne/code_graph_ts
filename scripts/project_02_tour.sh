#!/usr/bin/env bash
#
# Exercise the ts-knowledge-graph call-graph tools against sample_projects/project_02.
#
# Builds the graph from scratch, then demonstrates the behavioral-layer queries:
# who-calls (single caller and the empty/dead case), calls, and blast-radius,
# enriches with a live CPU profile (hotspots / cost), and closes on the two
# optimize-loop gates: verify (type-check + tests) and benchmark (parseTerm).
#
# Usage:  npm run project02:tour       (or)  bash scripts/project_02_tour.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT='sample_projects/project_02'
GRAPH='./outputs/project_02/graph'
DB='./outputs/project_02/graph.kuzu'
CLI='npx tsx src/cli.ts'

# Resolve a declaration to its node id by EXACT name. Optional 2nd argument
# filters by node kind, optional 3rd by a substring of the file path (some names
# repeat — there are two `evaluate` methods, Calc.evaluate and Evaluator.evaluate).
idof() {
	$CLI find "$1" --db "$DB" --json 2>/dev/null \
		| node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const l=Array.isArray(r)?r:(r.results||[]);const n=process.argv[1],k=process.argv[2],f=process.argv[3];const m=l.find(x=>x.name===n&&(k?x.kind===k:true)&&(f?(x.filePath||"").includes(f):true));if(!m){process.stderr.write("no node named "+n+"\n");process.exit(1);}process.stdout.write(m.id);' "$1" "${2:-}" "${3:-}"
}

section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

section 'rebuild the graph from scratch (clean → extract → load)'
rm -rf ./outputs/project_02
$CLI extract "$PROJECT" --semantic --out "$GRAPH"
$CLI load "$GRAPH" --db "$DB"

section 'dead-exports — none: this project has no orphan exports'
$CLI dead-exports --db "$DB"

section 'find parseParenthesized'
$CLI find parseParenthesized --db "$DB"

section 'who-calls parseParenthesized — a single-use helper (expect 1 caller: parsePrimary)'
$CLI who-calls "$(idof parseParenthesized)" --db "$DB"

section 'who-calls evaluatePostfix — DEAD code (expect no results)'
$CLI who-calls "$(idof evaluatePostfix)" --db "$DB"

section 'calls Calc.evaluate — what the entry point calls directly'
$CLI calls "$(idof evaluate Method calc.ts)" --db "$DB"

section 'blast-radius parsePrimary — transitive impact set up to main()'
$CLI blast-radius "$(idof parsePrimary)" --db "$DB" --depth 10

section 'enrich — attach measured runtime metrics from a live V8 CPU profile'
bash "$ROOT/scripts/profile_and_enrich.sh" project_02

section 'find parseTerm --json — the measured metrics now ride metadata.runtime (no schema change)'
$CLI find parseTerm --db "$DB" --json

section 'hotspots — rank the whole graph by measured self-time (what enrich just unlocked)'
$CLI hotspots --db "$DB" --by self-time

section 'cost — propagate self-time into inclusive cost, ranking by share of total (the causal view)'
$CLI cost --db "$DB"

section 'cost tokenize — where its inclusive cost goes (callees) and who is responsible for it (callers)'
$CLI cost "$(idof tokenize Method tokenizer.ts)" --db "$DB"

section 'verify — the optimize loop’s hard correctness gate: this project’s type-check + tests as one keep/revert verdict'
$CLI verify --cwd "$PROJECT"

section 'benchmark parseTerm — the advisory measured-impact gate: self-time over 3 runs (median + spread) on a fixed workload'
$CLI benchmark parseTerm --workload "$ROOT/scripts/benchmarks/project_02_workload.ts" --root "$PROJECT" --db "$DB" --runs 3

section 'done'
printf 'Interactive: explore the same graph in the browser with\n  npm run project02:web\n'
