// A repeatable benchmark workload for sample_projects/project_01: it exercises
// the real public string/array API under load so the V8 sampler catches the
// in-project hot frames (`titleCase`, `slugify`, `unique`/`flatten`/`chunk`).
//
// This file lives OUTSIDE the extracted source root so it never becomes a graph
// node. Imports are module-relative (not cwd-relative) so it runs from anywhere:
//
//   npx ts-knowledge-graph benchmark titleCase \
//     --workload scripts/benchmarks/project_01_workload.ts \
//     --db ./outputs/project_01/graph.kuzu --root ./sample_projects/project_01
import { ArrayUtils } from '../../sample_projects/project_01/src/utils/array_utils.js';
import { StringUtils } from '../../sample_projects/project_01/src/utils/string_utils.js';

const words = 'the quick brown fox jumps over the lazy dog '.repeat(60);
let sink = 0;
for (let i = 0; i < 200000; i += 1) {
	const slug = StringUtils.slugify(words);
	sink += StringUtils.titleCase(words).length;
	sink += ArrayUtils.unique(ArrayUtils.flatten(ArrayUtils.chunk(slug.split('-'), 3))).length;
}
console.log(sink);
