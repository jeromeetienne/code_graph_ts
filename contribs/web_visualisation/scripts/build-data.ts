import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const readJsonl = (path: string): unknown[] => readFileSync(path, 'utf8')
	.split('\n')
	.filter((line) => line.trim().length > 0)
	.map((line) => JSON.parse(line) as unknown);

const main = (): void => {
	const here = fileURLToPath(new URL('.', import.meta.url));
	const graphDir = process.argv[2] === undefined
		? join(here, '..', '..', '..', 'outputs', 'graph')
		: process.argv[2];

	const nodes = readJsonl(join(graphDir, 'nodes.jsonl'));
	const edges = readJsonl(join(graphDir, 'edges.jsonl'));

	const outPath = join(here, '..', 'web', 'data', 'graph_data.js');
	writeFileSync(outPath, `window.GRAPH_DATA = ${JSON.stringify({ nodes, edges })};\n`);
	console.log(`✓ ${nodes.length} nodes, ${edges.length} edges -> ${outPath}`);
};

main();
