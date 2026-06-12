// A repeatable benchmark workload for sample_projects/project_02: it evaluates a
// fixed set of arithmetic expressions under load so the V8 sampler catches the
// in-project hot frames (`parseTerm`, `parseExpression`, `readSymbol`, …).
//
// This file lives OUTSIDE the extracted source root so it never becomes a graph
// node. Imports are module-relative (not cwd-relative) so it runs from anywhere:
//
//   npx ts-knowledge-graph benchmark parseTerm \
//     --workload scripts/benchmarks/project_02_workload.ts \
//     --db ./outputs/project_02/graph.kuzu --root ./sample_projects/project_02
import { Calc } from '../../sample_projects/project_02/src/calc.js';

const expressions = ['1 + 2 * 3', '(1 + 2) * 3', '-4 + 10 / 2', '2 * (3 + 4) - 1', '((1+2)*(3+4))/5 - 6'];
let sink = 0;
for (let i = 0; i < 800000; i += 1) {
	for (const expression of expressions) sink += Calc.evaluate(expression);
}
console.log(sink);
