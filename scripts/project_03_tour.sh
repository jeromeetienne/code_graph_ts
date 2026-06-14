#!/usr/bin/env bash
#
# Exercise the ts-knowledge-graph type/heritage tools against sample_projects/project_03.
#
# Builds the graph from scratch, then demonstrates the type-layer queries:
# references and neighbors over EXTENDS / IMPLEMENTS / RETURNS / INSTANTIATES
# edges, plus the dead-export type alias. It enriches with a live CPU profile
# (hotspots / cost) and closes on the two optimize-loop gates: verify (type-check
# + tests) and benchmark (describe).
#
# Usage:  npm run project03:tour       (or)  bash scripts/project_03_tour.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT='sample_projects/project_03'
OUT='./outputs/project_03'
CLI='npx tsx src/cli.ts'

# Resolve a declaration to its node id by EXACT name. Optional 2nd argument
# filters by node kind, optional 3rd by a substring of the file path (the name
# `area` appears on four shapes).
idof() {
	$CLI find "$1" -o "$OUT" --json 2>/dev/null \
		| node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const l=Array.isArray(r)?r:(r.results||[]);const n=process.argv[1],k=process.argv[2],f=process.argv[3];const m=l.find(x=>x.name===n&&(k?x.kind===k:true)&&(f?(x.filePath||"").includes(f):true));if(!m){process.stderr.write("no node named "+n+"\n");process.exit(1);}process.stdout.write(m.id);' "$1" "${2:-}" "${3:-}"
}

section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

section 'rebuild the graph from scratch (clean → extract → load)'
rm -rf ./outputs/project_03/graph ./outputs/project_03/graph.kuzu ./outputs/project_03/prof
$CLI extract "$PROJECT/src" --semantic -o "$OUT"
$CLI load -o "$OUT"

section 'dead-exports — the planted dead type alias (expect Diameter)'
$CLI dead-exports -o "$OUT"

section 'find area — the same method name on four shapes (note the redundant Square.area)'
$CLI find area -o "$OUT"

section 'references Shape — subclasses via EXTENDS (expect Circle, Rectangle)'
$CLI references "$(idof Shape Class)" -o "$OUT"

section 'references Renderable — implementers via IMPLEMENTS (expect Circle, Rectangle)'
$CLI references "$(idof Renderable Interface)" -o "$OUT"

section 'references Rectangle — the redundant-override entry: Square EXTENDS + main INSTANTIATES'
$CLI references "$(idof Rectangle Class)" -o "$OUT"

section 'references Rectangle.area — the redundant override itself, via OVERRIDES (expect Square.area)'
$CLI references "$(idof area Method rectangle.ts)" -o "$OUT"

section 'references BoundingBox — type usage via RETURNS'
$CLI references "$(idof BoundingBox TypeAlias)" -o "$OUT"

section 'neighbors Square — one-hop heritage: EXTENDS Rectangle, contains area, instantiated by main'
$CLI neighbors "$(idof Square Class)" -o "$OUT"

section 'cluster — group symbols into modules with the Leiden algorithm; the community index rides metadata.community (no schema change)'
$CLI cluster -o "$OUT"

section 'enrich — attach measured runtime metrics from a live V8 CPU profile'
bash "$ROOT/scripts/profile_and_enrich.sh" project_03

section 'find describe --json — the measured metrics now ride metadata.runtime (no schema change)'
$CLI find describe -o "$OUT" --json

section 'hotspots — rank the whole graph by measured self-time (what enrich just unlocked)'
$CLI hotspots -o "$OUT" --by self-time

section 'cost — propagate self-time into inclusive cost, ranking by share of total (the causal view)'
$CLI cost -o "$OUT"

# project_03 is a pure virtual-dispatch example, so this drill-down is deliberately
# thin: `describe` calls `this.area()` typed as `Shape`, so its static CALLS edge
# targets the *abstract* `Shape.area` (no body, zero runtime). The real work is in
# the concrete overrides (Circle/Rectangle/Square.area), reached by dynamic dispatch
# the graph records as OVERRIDES — not the call target. So cost has nothing to flow
# into and the callee flow reads 0 ms: that zero is structural (a static-dispatch
# blind spot), not a profiling artifact.
section 'cost describe — where its inclusive cost goes (callees) and who is responsible for it (callers)'
$CLI cost "$(idof describe Method shape.ts)" -o "$OUT"
printf '\033[2m  note: the area flow above is 0 by design — describe calls this.area() typed as Shape, so the\n        static CALLS edge targets the abstract Shape.area (no runtime); the real work is in the\n        concrete overrides, reached by dynamic dispatch the graph records as OVERRIDES, not CALLS.\033[0m\n'

section 'verify — the optimize loop’s hard correctness gate: this project’s type-check + tests as one keep/revert verdict'
$CLI verify --cwd "$PROJECT"

section 'benchmark describe — the advisory measured-impact gate: self-time over 3 runs (median + spread) on a fixed workload'
$CLI benchmark describe --workload "$ROOT/scripts/benchmarks/project_03_workload.ts" --root "$PROJECT" -o "$OUT" --runs 3

section 'report — write the CODEBASE_BRIEF, one shareable snapshot of everything above'
$CLI report -o "$OUT"

section 'done'
printf 'Interactive: explore the same graph in the browser with\n  npm run project03:webview\n'
