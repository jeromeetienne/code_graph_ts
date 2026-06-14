import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GraphReport } from '../src/report/graph_report.js';
import { GraphReportData } from '../src/report/report_data.js';

/** A minimal un-enriched report: semantic graph, one hub, one dead export, no runtime. */
const BASE: GraphReportData = {
	generatedAt: '2026-06-14',
	project: 'acme/widget',
	outputFolder: './outputs/widget',
	provenance: { baseUrl: 'https://github.com/acme/widget', commit: 'abcdef1234567890', prefix: 'src/' },
	semantic: true,
	enriched: false,
	coverage: null,
	totalSelf: 0,
	limit: 10,
	totals: { symbols: 3, files: 2, relationships: 4, communities: 0, deadExports: 1, cycles: 0 },
	verdict: '3 symbols across 2 files — semantic, acyclic. 1 exported symbol(s) appear dead.',
	nodeKinds: [{ kind: 'Function', count: 2 }, { kind: 'Module', count: 1 }],
	edgeKinds: [{ kind: 'CALLS', count: 3 }, { kind: 'CONTAINS', count: 1 }],
	hubsByCallers: [{ name: 'helper', kind: 'Function', filePath: 'src/a.ts', startLine: 3, score: 2 }],
	hubsByBlastRadius: [{ name: 'helper', kind: 'Function', filePath: 'src/a.ts', startLine: 3, score: 2 }],
	communityQuality: null,
	communities: [],
	hotspots: [],
	cost: [],
	structureVsRuntime: { orchestrators: [], hiddenHotspots: [], alignedCore: [] },
	cycles: [],
	boundary: { endpoints: [], configFlags: [], externalApis: [] },
	deadExports: [{ name: 'unusedThing', kind: 'Function', filePath: 'src/b.ts', startLine: 9 }],
};

/** The same shape, enriched: a single hot symbol that is also a hidden hotspot. */
const enriched = (): GraphReportData => ({
	...BASE,
	enriched: true,
	coverage: 0.63,
	totalSelf: 100,
	communities: [{ label: 'core', size: 3 }],
	communityQuality: 0.71,
	hotspots: [{ name: 'hot', kind: 'Function', filePath: 'src/a.ts', startLine: 1, score: 50 }],
	cost: [{ name: 'hot', kind: 'Function', filePath: 'src/a.ts', startLine: 1, selfCost: 50, inclusiveCost: 80, shareOfTotal: 0.8, cyclic: false, cycleSize: 1 }],
	structureVsRuntime: { orchestrators: [], hiddenHotspots: [{ name: 'hot', kind: 'Function', filePath: 'src/a.ts', startLine: 1 }], alignedCore: [] },
});

describe('GraphReport.render markdown', () => {
	it('includes the headline, banner, and every section heading', () => {
		const markdown = GraphReport.render(BASE, 'markdown');
		assert.match(markdown, /^# Codebase brief — acme\/widget/);
		assert.match(markdown, /\*\*semantic ✓ · enriched —\*\*/);
		for (const heading of ['## Snapshot', '## Composition', '## Load-bearing code', '## Communities', '## Runtime', '## Cycles', '## System boundary', '## Cleanup candidates', '## Where to go next']) {
			assert.ok(markdown.includes(heading), `missing ${heading}`);
		}
	});

	it('degrades gracefully when not enriched', () => {
		const markdown = GraphReport.render(BASE, 'markdown');
		assert.match(markdown, /Run `enrich` to populate/);
		assert.equal(markdown.includes('## Structure vs. runtime'), false);
		assert.match(markdown, /No call cycles detected/);
		assert.match(markdown, /No endpoints, configuration flags/);
		assert.match(markdown, /No communities assigned/);
	});

	it('renders runtime tables and the structure section when enriched', () => {
		const markdown = GraphReport.render(enriched(), 'markdown');
		assert.ok(markdown.includes('## Structure vs. runtime'));
		assert.match(markdown, /Hidden hotspots.*`hot`/);
		assert.match(markdown, /\| `hot` \| 50\.0 \|/);
		assert.match(markdown, /80\.0 \| 80\.0%/);
	});

	it('lists dead exports as a table row', () => {
		const markdown = GraphReport.render(BASE, 'markdown');
		assert.match(markdown, /\| `unusedThing` \| Function \| `src\/b\.ts:9` \|/);
	});
});

describe('GraphReport.render json', () => {
	it('round-trips the data object', () => {
		const parsed = JSON.parse(GraphReport.render(BASE, 'json'));
		assert.equal(parsed.project, 'acme/widget');
		assert.equal(parsed.totals.symbols, 3);
		assert.equal(parsed.deadExports[0].name, 'unusedThing');
	});
});

describe('GraphReport.renderVisualHtml', () => {
	it('produces a self-contained document', () => {
		const html = GraphReport.renderVisualHtml(enriched());
		assert.ok(html.startsWith('<!DOCTYPE html>'));
		assert.ok(html.includes('Codebase brief — acme/widget'));
		assert.ok(html.includes('bar-fill'));
		assert.ok(html.trimEnd().endsWith('</html>'));
	});

	it('escapes html so a symbol name cannot inject markup', () => {
		const html = GraphReport.renderVisualHtml({ ...BASE, project: 'a<b>&"c' });
		assert.ok(html.includes('a&lt;b&gt;&amp;&quot;c'));
		assert.equal(html.includes('a<b>'), false);
	});
});

describe('GraphReport.permalink', () => {
	it('builds a github blob url with prefix and line', () => {
		const link = GraphReport.permalink(BASE.provenance, { name: 'x', kind: 'Function', filePath: 'utils/y.ts', startLine: 12 });
		assert.equal(link, 'https://github.com/acme/widget/blob/abcdef1234567890/src/utils/y.ts#L12');
	});

	it('returns null without provenance', () => {
		assert.equal(GraphReport.permalink(null, { name: 'x', kind: 'Function', filePath: 'a.ts', startLine: 1 }), null);
	});
});
