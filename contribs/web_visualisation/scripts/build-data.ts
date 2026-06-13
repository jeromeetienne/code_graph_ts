import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_KIND_DESCRIPTIONS } from '../../../src/schema/node.js';
import { EDGE_KIND_DESCRIPTIONS } from '../../../src/schema/edge.js';

/**
 * Prepended to every generated `.js` data file so editors and the project
 * type-check skip them — they are emitted artifacts, not hand-written source.
 */
const TS_NOCHECK_BANNER = '// @ts-nocheck\n';

const readJsonl = (path: string): unknown[] => readFileSync(path, 'utf8')
	.split('\n')
	.filter((line) => line.trim().length > 0)
	.map((line) => JSON.parse(line) as unknown);

/**
 * Writes the static node/edge kind descriptions (the single source of truth in
 * `src/schema`) to `web/data/kind_descriptions.js`. This file is committed and
 * independent of any loaded graph, so the legend tooltips work on every load
 * path — embedded data, fetched JSONL, or drag-and-drop — without a rebuild.
 */
const writeKindDescriptions = (dataDir: string): void => {
	const payload = { nodes: NODE_KIND_DESCRIPTIONS, edges: EDGE_KIND_DESCRIPTIONS };
	const outPath = join(dataDir, 'kind_descriptions.js');
	const banner = `${TS_NOCHECK_BANNER}// Generated from src/schema by scripts/build-data.ts. Do not edit by hand.\n`;
	writeFileSync(outPath, `${banner}window.KIND_DESCRIPTIONS = ${JSON.stringify(payload, null, '\t')};\n`);
	console.log(`✓ ${Object.keys(NODE_KIND_DESCRIPTIONS).length} node + ${Object.keys(EDGE_KIND_DESCRIPTIONS).length} edge descriptions -> ${outPath}`);
};

const main = (): void => {
	const here = fileURLToPath(new URL('.', import.meta.url));
	const graphDir = process.argv[2] === undefined
		? join(here, '..', '..', '..', 'outputs', 'graph')
		: process.argv[2];

	const nodes = readJsonl(join(graphDir, 'nodes.jsonl'));
	const edges = readJsonl(join(graphDir, 'edges.jsonl'));

	const dataDir = join(here, '..', 'web', 'data');
	const outPath = join(dataDir, 'graph_data.js');
	writeFileSync(outPath, `${TS_NOCHECK_BANNER}window.GRAPH_DATA = ${JSON.stringify({ nodes, edges })};\n`);
	console.log(`✓ ${nodes.length} nodes, ${edges.length} edges -> ${outPath}`);

	writeKindDescriptions(dataDir);
};

main();
