#!/usr/bin/env bash
#
# Generate a live V8 CPU profile for a sample project and enrich its graph with
# the measured runtime metrics (self time + sample count) via `enrich`.
#
# A short workload that exercises the project's public API is written into the
# project, run under `node --cpu-prof --import tsx` (a line-collapsing loader —
# the name-aware join handles it), then removed. The resulting `.cpuprofile` is
# joined onto the loaded graph at ./outputs/<project>/graph.kuzu.
#
# Usage:  bash scripts/profile_and_enrich.sh project_01
#         npm run project01:enrich
#
# Prerequisite: the graph database must already be built and loaded
# (npm run projectNN:rebuild), exactly like the other projectNN query scripts.
set -euo pipefail

PROJECT="${1:?usage: profile_and_enrich.sh <project_01|project_02|project_03|project_04>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJ="$ROOT/sample_projects/$PROJECT"
DB="$ROOT/outputs/$PROJECT/graph.kuzu"
PROFDIR="$ROOT/outputs/$PROJECT/prof"
CLI='npx tsx src/cli.ts'

if [ ! -d "$PROJ" ]; then
	echo "unknown project: $PROJECT (expected sample_projects/$PROJECT)" >&2
	exit 1
fi
if [ ! -e "$DB" ]; then
	echo "graph database not found at $DB — run 'npm run ${PROJECT/project_/project}:rebuild' first" >&2
	exit 1
fi

# A workload per project, exercising the real public API under load so the
# sampler catches in-project frames. `describe`/`titleCase`/`parseTerm` are the
# non-inlined hot paths these drive.
workload() {
	case "$PROJECT" in
	project_01)
		cat <<'EOF'
import { StringUtils } from './src/utils/string_utils.js';
import { ArrayUtils } from './src/utils/array_utils.js';
const words = 'the quick brown fox jumps over the lazy dog '.repeat(60);
let sink = 0;
for (let i = 0; i < 200000; i += 1) {
	const slug = StringUtils.slugify(words);
	sink += StringUtils.titleCase(words).length;
	sink += ArrayUtils.unique(ArrayUtils.flatten(ArrayUtils.chunk(slug.split('-'), 3))).length;
}
console.log(sink);
EOF
		;;
	project_02)
		cat <<'EOF'
import { Calc } from './src/calc.js';
const expressions = ['1 + 2 * 3', '(1 + 2) * 3', '-4 + 10 / 2', '2 * (3 + 4) - 1', '((1+2)*(3+4))/5 - 6'];
let sink = 0;
for (let i = 0; i < 800000; i += 1) {
	for (const expression of expressions) sink += Calc.evaluate(expression);
}
console.log(sink);
EOF
		;;
	project_03)
		cat <<'EOF'
import { Circle } from './src/shapes/circle.js';
import { Rectangle } from './src/shapes/rectangle.js';
import { Square } from './src/shapes/square.js';
import type { Shape } from './src/shapes/shape.js';
const shapes: Shape[] = [new Circle({ x: 0, y: 0 }, 2), new Rectangle({ x: 0, y: 0 }, 3, 4), new Square({ x: 0, y: 0 }, 5)];
let sink = 0;
for (let i = 0; i < 4000000; i += 1) {
	const shape = shapes[i % 3];
	sink += shape.describe().length + shape.area();
}
console.log(sink);
EOF
		;;
	project_04)
		cat <<'EOF'
import { Simulator } from './src/sim/simulator.js';
import { ROUTE_PROFILES } from './src/endpoints/registry.js';
import { DEFAULT_ARRIVAL_RATES } from './src/workload/workload.js';
import { loadHardware } from './src/config/hardware.js';
const hardware = loadHardware();
let sink = 0;
for (let i = 0; i < 300000; i += 1) {
	const result = Simulator.run(ROUTE_PROFILES, DEFAULT_ARRIVAL_RATES, hardware);
	sink += result.totalServers + result.perDimension[i % 3].latencyMs;
}
console.log(sink);
EOF
		;;
	*)
		echo "no workload defined for $PROJECT" >&2
		exit 1
		;;
	esac
}

DRIVER="$PROJ/._enrich_workload.ts"
cleanup() { rm -f "$DRIVER"; }
trap cleanup EXIT

rm -rf "$PROFDIR" && mkdir -p "$PROFDIR"
workload > "$DRIVER"

echo "Profiling $PROJECT workload under V8 (node --cpu-prof --import tsx) ..."
node --cpu-prof --cpu-prof-dir "$PROFDIR" --import tsx "$DRIVER" >/dev/null
PROFILE="$(ls -t "$PROFDIR"/*.cpuprofile | head -1)"

$CLI enrich "$PROFILE" --db "$DB" --root "$PROJ"
