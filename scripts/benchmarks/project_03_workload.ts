// A repeatable benchmark workload for sample_projects/project_03: it drives the
// virtual-dispatch shape API under load so the V8 sampler catches the in-project
// hot frame (`describe`, plus the concrete `area` overrides).
//
// This file lives OUTSIDE the extracted source root so it never becomes a graph
// node. Imports are module-relative (not cwd-relative) so it runs from anywhere:
//
//   npx ts-knowledge-graph benchmark describe \
//     --workload scripts/benchmarks/project_03_workload.ts \
//     --db ./outputs/project_03/graph.kuzu --root ./sample_projects/project_03
import { Circle } from '../../sample_projects/project_03/src/shapes/circle.js';
import { Rectangle } from '../../sample_projects/project_03/src/shapes/rectangle.js';
import { Square } from '../../sample_projects/project_03/src/shapes/square.js';
import type { Shape } from '../../sample_projects/project_03/src/shapes/shape.js';

const shapes: Shape[] = [new Circle({ x: 0, y: 0 }, 2), new Rectangle({ x: 0, y: 0 }, 3, 4), new Square({ x: 0, y: 0 }, 5)];
let sink = 0;
for (let i = 0; i < 4000000; i += 1) {
	const shape = shapes[i % 3];
	sink += shape.describe().length + shape.area();
}
console.log(sink);
