#!/usr/bin/env bash
#
# Exercise the ts-knowledge-graph system-level tools against sample_projects/project_04.
#
# Builds the graph from scratch, then demonstrates the system-level layer:
# Endpoint / HANDLES (routes and their handlers), ConfigFlag / READS_CONFIG
# (the process.env surface), and ExternalAPI / CALLS_EXTERNAL (outbound fetch).
# It closes on verify, the optimize loop's correctness gate — here it shows
# graceful degradation: project_04 has a type-check but no test script, so verify
# runs type-check-only and reports behaviour as NOT verified. There is no
# benchmark step: this is a system-level routing sample with no CPU hot path.
#
# Usage:  npm run project04:tour       (or)  bash scripts/project_04_tour.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT='sample_projects/project_04'
GRAPH='./outputs/project_04/graph'
DB='./outputs/project_04/graph.kuzu'
CLI='npx tsx src/cli.ts'

# Resolve a declaration to its node id by EXACT name; optional 2nd arg filters by kind.
idof() {
	$CLI find "$1" --db "$DB" --json 2>/dev/null \
		| node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const l=Array.isArray(r)?r:(r.results||[]);const n=process.argv[1],k=process.argv[2];const m=l.find(x=>x.name===n&&(k?x.kind===k:true));if(!m){process.stderr.write("no node named "+n+"\n");process.exit(1);}process.stdout.write(m.id);' "$1" "${2:-}"
}

section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

section 'rebuild the graph from scratch (clean → extract → load)'
rm -rf ./outputs/project_04
$CLI extract "$PROJECT" --semantic --out "$GRAPH"
$CLI load "$GRAPH" --db "$DB"

section 'find Endpoint — the four registered routes by kind (note the inline GET /ping)'
$CLI find Endpoint --db "$DB"

section 'neighbors GET /users — the route and its handler via HANDLES (expect listUsers)'
$CLI neighbors 'Endpoint:GET /users' --db "$DB"

section 'references listUsers — who routes to this handler, via HANDLES (expect GET /users)'
$CLI references "$(idof listUsers Function)" --db "$DB"

section 'find ConfigFlag — the environment variables the app reads (by kind)'
$CLI find ConfigFlag --db "$DB"

section 'neighbors Config:PORT — the declarations that read it via READS_CONFIG'
$CLI neighbors 'Config:PORT' --db "$DB"

section 'find ExternalAPI — outbound HTTP hosts the app calls (by kind)'
$CLI find ExternalAPI --db "$DB"

section 'neighbors api.github.com — the call sites via CALLS_EXTERNAL (expect fetchRepos)'
$CLI neighbors 'Api:api.github.com' --db "$DB"

section 'verify — the optimize loop’s correctness gate; project_04 has no test script, so it degrades to type-check-only and says so'
$CLI verify --cwd "$PROJECT"

section 'done'
printf 'Interactive: explore the same graph in the browser with\n  npm run project04:web\n'
