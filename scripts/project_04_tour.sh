#!/usr/bin/env bash
#
# Exercise the ts-knowledge-graph system-level tools against sample_projects/project_04.
#
# Builds the graph from scratch, then demonstrates the system-level layer: Endpoint /
# HANDLES (routes and their handlers), ConfigFlag / READS_CONFIG (the process.env
# hardware caps), and ExternalAPI / CALLS_EXTERNAL (the outbound traffic-baseline
# fetch). It then shows the type/heritage layer the LAMP capacity simulation adds —
# IMPLEMENTS over the three per-dimension simulators and RETURNS over the result
# types — and the behavioral spine through Simulator.run. It enriches with a live
# CPU profile (the steady-state capacity math is a real hot path), closes on verify
# (this project now has tests, so it is a full type-check + test pass), and finishes
# with the #38 open-loop load generator: a deterministic ramp to a capacity verdict.
#
# Usage:  npm run project04:tour       (or)  bash scripts/project_04_tour.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT='sample_projects/project_04'
OUT='./outputs/project_04'
CLI='npx tsx src/cli.ts'

# Resolve a declaration to its node id by EXACT name. Optional 2nd argument filters
# by node kind, optional 3rd by a substring of the file path.
idof() {
	$CLI find "$1" -o "$OUT" --json 2>/dev/null \
		| node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const l=Array.isArray(r)?r:(r.results||[]);const n=process.argv[1],k=process.argv[2],f=process.argv[3];const m=l.find(x=>x.name===n&&(k?x.kind===k:true)&&(f?(x.filePath||"").includes(f):true));if(!m){process.stderr.write("no node named "+n+"\n");process.exit(1);}process.stdout.write(m.id);' "$1" "${2:-}" "${3:-}"
}

section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

section 'rebuild the graph from scratch (clean → extract → load)'
rm -rf ./outputs/project_04/graph ./outputs/project_04/graph.kuzu ./outputs/project_04/prof
$CLI extract "$PROJECT/src" --semantic -o "$OUT"
$CLI load -o "$OUT"

section 'find Endpoint — the five registered routes by kind'
$CLI find Endpoint -o "$OUT"

section 'neighbors GET /search — the route and its handler via HANDLES (expect searchProducts)'
$CLI neighbors 'Endpoint:GET /search' -o "$OUT"

section 'references searchProducts — who routes to this handler, via HANDLES (expect GET /search)'
$CLI references "$(idof searchProducts Function)" -o "$OUT"

section 'find ConfigFlag — the hardware caps the server reads from the environment (by kind)'
$CLI find ConfigFlag -o "$OUT"

section 'neighbors Config:MAX_CPU_MILLIS — the declarations that read it via READS_CONFIG'
$CLI neighbors 'Config:MAX_CPU_MILLIS' -o "$OUT"

section 'find ExternalAPI — outbound HTTP hosts the server calls (by kind)'
$CLI find ExternalAPI -o "$OUT"

section 'neighbors metrics.internal.example.com — the call sites via CALLS_EXTERNAL (expect fetchTrafficBaseline)'
$CLI neighbors 'Api:metrics.internal.example.com' -o "$OUT"

section 'references DimensionSimulator — implementers via IMPLEMENTS (expect Cpu/Network/DiskSimulator)'
$CLI references "$(idof DimensionSimulator Interface)" -o "$OUT"

section 'references DimensionResult — where the per-dimension result type is produced, via RETURNS'
$CLI references "$(idof DimensionResult TypeAlias)" -o "$OUT"

section 'neighbors Simulator.run — one hop: builds the simulators, sums demand, called by main'
$CLI neighbors "$(idof run Method simulator.ts)" -o "$OUT"

section 'cluster — group symbols into modules with the Leiden algorithm; the community index rides metadata.community (no schema change)'
$CLI cluster -o "$OUT"

section 'enrich — attach measured runtime from a live V8 CPU profile (the steady-state capacity math)'
bash "$ROOT/scripts/profile_and_enrich.sh" project_04

section 'hotspots — rank the whole graph by measured self-time (what enrich just unlocked)'
$CLI hotspots -o "$OUT" --by self-time

section 'cost — propagate self-time into inclusive cost, ranking by share of total (the causal view)'
$CLI cost -o "$OUT"

section 'verify — the optimize loop’s correctness gate; project_04 now has tests, so this is a full type-check + test pass'
$CLI verify --cwd "$PROJECT"

section 'load generator (#38) — a deterministic open-loop ramp to the capacity verdict'
npx tsx "$ROOT/scripts/benchmarks/project_04_workload.ts"

section 'report — write the CODEBASE_BRIEF, one shareable snapshot of everything above'
$CLI report -o "$OUT"

section 'done'
printf 'Interactive: explore the same graph in the browser with\n  npm run project04:webview\n'
