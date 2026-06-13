'use strict';

const NODE_COLORS = {
	Module: '#4f8cff',
	Class: '#f59e0b',
	Interface: '#a78bfa',
	TypeAlias: '#34d399',
	Enum: '#f472b6',
	Function: '#fb923c',
	Method: '#facc15',
	Property: '#94a3b8',
	Parameter: '#64748b',
	Variable: '#2dd4bf',
	ExternalModule: '#6b7280',
	ConfigFlag: '#84cc16',
	ExternalAPI: '#fb7185',
	Endpoint: '#38bdf8',
};

const EDGE_COLORS = {
	CONTAINS: '#475569',
	IMPORTS: '#64748b',
	EXPORTS: '#64748b',
	CALLS: '#ef4444',
	INSTANTIATES: '#f97316',
	EXTENDS: '#8b5cf6',
	IMPLEMENTS: '#a78bfa',
	USES_TYPE: '#10b981',
	RETURNS: '#14b8a6',
	PARAM_TYPE: '#06b6d4',
	READS: '#eab308',
	WRITES: '#eab308',
	OVERRIDES: '#94a3b8',
	READS_CONFIG: '#65a30d',
	CALLS_EXTERNAL: '#e11d48',
	HANDLES: '#0ea5e9',
};

/* One-line descriptions per node/edge kind, generated from src/schema into
   data/kind_descriptions.js. Absent (empty) when that file has not been built. */
const KIND_DESCRIPTIONS = window.KIND_DESCRIPTIONS ?? { nodes: {}, edges: {} };

/* Heat ramp for runtime self-time: cool slate → yellow → red ("red = hot"). */
const HEAT_STOPS = [
	{ at: 0, color: [100, 116, 139] },
	{ at: 0.5, color: [253, 224, 71] },
	{ at: 1, color: [220, 38, 38] },
];

/* Un-measured nodes render at a neutral baseline, distinct from a cheap-but-measured node. */
const RUNTIME_UNMEASURED_COLOR = '#243044';
const RUNTIME_UNMEASURED_BORDER = '#475569';
const HOTSPOTS_LIMIT = 12;

const state = {
	nodes: [],
	edges: [],
	cy: undefined,
	hiddenNodeKinds: new Set(),
	hiddenEdgeKinds: new Set(),
	hideIsolated: false,
	onlyMeasured: false,
	droppedFiles: { nodes: undefined, edges: undefined },
	encoding: 'structural',
	runtime: { maxSelfMs: 0, measuredCount: 0, totalSelfMs: 0 },
};

const el = (id) => document.getElementById(id);

/* ---------- data loading ---------- */

function boot() {
	setupDropzone();
	setupFolds();
	el('hide-isolated').addEventListener('change', (event) => {
		state.hideIsolated = event.target.checked;
		applyFilters();
	});
	el('relayout').addEventListener('click', () => runLayout());
	el('runtime-heat').addEventListener('change', (event) => {
		state.encoding = event.target.checked === true ? 'runtime' : 'structural';
		if (state.cy !== undefined) {
			state.cy.style(cyStyle());
		}
	});
	el('only-measured').addEventListener('change', (event) => {
		state.onlyMeasured = event.target.checked;
		applyFilters();
	});
	el('search').addEventListener('input', () => renderSearchResults());
	el('search').addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			const first = document.querySelector('#search-results .hit');
			if (first !== null) {
				first.click();
			}
		}
	});

	if (window.GRAPH_DATA !== undefined) {
		setData(window.GRAPH_DATA.nodes, window.GRAPH_DATA.edges, 'embedded graph_data.js');
		return;
	}
	if (location.protocol.startsWith('http') === true) {
		tryFetch();
		return;
	}
	el('status').textContent = 'no data — run `npm run build`, or drop the JSONL files here';
}

async function tryFetch() {
	try {
		const [nodesText, edgesText] = await Promise.all([
			fetch('../../../outputs/graph/nodes.jsonl').then((r) => r.ok === true ? r.text() : Promise.reject(new Error(String(r.status)))),
			fetch('../../../outputs/graph/edges.jsonl').then((r) => r.ok === true ? r.text() : Promise.reject(new Error(String(r.status)))),
		]);
		setData(parseJsonl(nodesText), parseJsonl(edgesText), 'fetched ../../../outputs/graph/*.jsonl');
	} catch {
		el('status').textContent = 'no data — generate data/graph_data.js or drop the JSONL files here';
	}
}

function parseJsonl(text) {
	return text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

function setupDropzone() {
	const zone = el('dropzone');
	window.addEventListener('dragover', (event) => {
		event.preventDefault();
		zone.classList.add('active');
	});
	window.addEventListener('dragleave', (event) => {
		if (event.relatedTarget === null) {
			zone.classList.remove('active');
		}
	});
	window.addEventListener('drop', async (event) => {
		event.preventDefault();
		zone.classList.remove('active');
		for (const file of event.dataTransfer.files) {
			const records = parseJsonl(await file.text());
			if (records.length === 0) {
				continue;
			}
			if (records[0].from !== undefined && records[0].to !== undefined) {
				state.droppedFiles.edges = records;
			} else {
				state.droppedFiles.nodes = records;
			}
		}
		if (state.droppedFiles.nodes !== undefined && state.droppedFiles.edges !== undefined) {
			setData(state.droppedFiles.nodes, state.droppedFiles.edges, 'dropped files');
		} else {
			el('status').textContent = 'got one file — drop the other one too';
		}
	});
}

/* ---------- foldable sections ---------- */

const FOLD_STORAGE_KEY = 'ktg.sidebar.folds';

/** Reads the persisted collapsed-by-key map, tolerating absent or malformed storage. */
function loadFolds() {
	try {
		const raw = localStorage.getItem(FOLD_STORAGE_KEY);
		const parsed = raw === null ? {} : JSON.parse(raw);
		return parsed !== null && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/** Persists the collapsed-by-key map; a no-op when storage is unavailable (private mode, file://). */
function saveFolds(folds) {
	try {
		localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds));
	} catch {
		return;
	}
}

/**
 * Wires every `.foldable` sidebar header to collapse the elements that follow it
 * (handled in CSS via `.collapsed ~ *`), restoring and persisting the per-section
 * state in localStorage so folds survive reloads.
 */
function setupFolds() {
	const folds = loadFolds();
	for (const header of document.querySelectorAll('#sidebar .foldable')) {
		const key = header.dataset.fold;
		if (key === undefined) {
			continue;
		}
		header.classList.toggle('collapsed', folds[key] === true);
		header.addEventListener('click', () => {
			folds[key] = header.classList.toggle('collapsed');
			saveFolds(folds);
		});
	}
}

/* ---------- graph construction ---------- */

function setData(nodes, edges, sourceLabel) {
	state.nodes = nodes;
	state.edges = edges;

	const nodeIds = new Set(nodes.map((node) => node.id));
	const degree = new Map();
	for (const edge of edges) {
		degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
		degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
	}

	let maxSelfMs = 0;
	let measuredCount = 0;
	let totalSelfMs = 0;
	for (const node of nodes) {
		const runtime = nodeRuntime(node);
		if (runtime === undefined) {
			continue;
		}
		const selfMs = runtime.selfMs ?? 0;
		measuredCount += 1;
		totalSelfMs += selfMs;
		maxSelfMs = Math.max(maxSelfMs, selfMs);
	}
	state.runtime = { maxSelfMs, measuredCount, totalSelfMs };

	const elements = [
		...nodes.map((node) => ({
			group: 'nodes',
			data: { id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.range === undefined ? 0 : node.range.startLine, exported: node.exported === true, degree: degree.get(node.id) ?? 0, runtime: nodeRuntime(node) },
		})),
		...edges
			.filter((edge) => nodeIds.has(edge.from) === true && nodeIds.has(edge.to) === true)
			.map((edge) => ({
				group: 'edges',
				data: { id: edge.id, source: edge.from, target: edge.to, kind: edge.kind, count: edgeCount(edge) },
			})),
	];

	if (state.cy !== undefined) {
		state.cy.destroy();
	}
	state.cy = cytoscape({
		container: el('cy'),
		elements,
		style: cyStyle(),
		layout: { name: 'cose', animate: false, padding: 30 },
	});
	state.cy.on('tap', 'node', (event) => select(event.target));
	state.cy.on('tap', (event) => {
		if (event.target === state.cy) {
			clearSelection();
		}
	});

	buildLegends();
	renderRuntime();
	applyFilters();
	el('status').textContent = `${sourceLabel} — ${nodes.length} nodes, ${edges.length} edges`;
}

function cyStyle() {
	const nodeColor = (node) => {
		if (state.encoding !== 'runtime') {
			return NODE_COLORS[node.data('kind')] ?? '#9ca3af';
		}
		const runtime = node.data('runtime');
		if (runtime === undefined || runtime === null) {
			return RUNTIME_UNMEASURED_COLOR;
		}
		return heatColor(runtimeFraction(runtime.selfMs));
	};
	const nodeSize = (node) => {
		if (state.encoding !== 'runtime') {
			return 8 + Math.sqrt(node.data('degree')) * 4;
		}
		const runtime = node.data('runtime');
		if (runtime === undefined || runtime === null) {
			return 10;
		}
		return 12 + runtimeFraction(runtime.selfMs) * 40;
	};
	const isUnmeasured = (node) => node.data('runtime') === undefined || node.data('runtime') === null;
	return [
		{
			selector: 'node',
			style: {
				'background-color': nodeColor,
				'width': nodeSize,
				'height': nodeSize,
				'border-width': (node) => state.encoding === 'runtime' && isUnmeasured(node) === true ? 1 : 0,
				'border-color': RUNTIME_UNMEASURED_BORDER,
				'border-style': 'dashed',
				'label': 'data(name)',
				'color': '#cbd5e1',
				'font-size': 8,
				'min-zoomed-font-size': 7,
				'text-valign': 'bottom',
				'text-margin-y': 3,
			},
		},
		{
			selector: 'edge',
			style: {
				'width': (edge) => edgeWidth(edge.data('count')),
				'line-color': (edge) => EDGE_COLORS[edge.data('kind')] ?? '#475569',
				'target-arrow-color': (edge) => EDGE_COLORS[edge.data('kind')] ?? '#475569',
				'target-arrow-shape': 'triangle',
				'arrow-scale': 0.6,
				'curve-style': 'bezier',
				'opacity': 0.65,
			},
		},
		{ selector: '.hidden', style: { display: 'none' } },
		{ selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0 } },
		{ selector: 'node.sel', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'solid' } },
	];
}

function runLayout() {
	const name = el('layout-select').value;
	const options = name === 'concentric'
		? { name, concentric: (node) => node.degree(), levelWidth: () => 2, animate: false, padding: 30 }
		: { name, animate: false, padding: 30 };
	state.cy.elements(':visible').layout(options).run();
}

/* ---------- edge weighting ---------- */

/** Reads the call-site multiplicity off a raw edge's metadata; defaults to 1 when absent. */
function edgeCount(edge) {
	if (edge.metadata === undefined || edge.metadata === null) {
		return 1;
	}
	const count = edge.metadata.count;
	return typeof count === 'number' && count > 0 ? count : 1;
}

/** Maps a call-site count to a stroke width: count 1 keeps the baseline, higher counts thicken sub-linearly. */
function edgeWidth(count) {
	const value = typeof count === 'number' && count > 0 ? count : 1;
	return 1 + Math.sqrt(value - 1) * 1.8;
}

/* ---------- legends & filtering ---------- */

function buildLegends() {
	const nodeCounts = countBy(state.nodes.map((node) => node.kind));
	const edgeCounts = countBy(state.edges.map((edge) => edge.kind));
	renderLegend(el('node-kinds'), nodeCounts, NODE_COLORS, state.hiddenNodeKinds, KIND_DESCRIPTIONS.nodes);
	renderLegend(el('edge-kinds'), edgeCounts, EDGE_COLORS, state.hiddenEdgeKinds, KIND_DESCRIPTIONS.edges);
}

function renderLegend(container, counts, colors, hiddenSet, descriptions) {
	container.innerHTML = '';
	const kinds = counts.map(([kind]) => kind);
	const childCheckboxes = [];

	/* Master toggle: checked when every kind is visible, indeterminate on a mixed
	   selection. Clicking it reveals all kinds, or hides all when none are hidden. */
	const master = document.createElement('input');
	master.type = 'checkbox';
	const syncMaster = () => {
		const hiddenCount = kinds.filter((kind) => hiddenSet.has(kind) === true).length;
		master.checked = hiddenCount === 0;
		master.indeterminate = hiddenCount > 0 && hiddenCount < kinds.length;
	};

	if (kinds.length > 0) {
		master.addEventListener('change', () => {
			const allVisible = kinds.every((kind) => hiddenSet.has(kind) === false);
			for (const kind of kinds) {
				if (allVisible === true) {
					hiddenSet.add(kind);
				} else {
					hiddenSet.delete(kind);
				}
			}
			for (const child of childCheckboxes) {
				child.checked = hiddenSet.has(child.dataset.kind) === false;
			}
			syncMaster();
			applyFilters();
		});
		const masterLabel = document.createElement('label');
		masterLabel.className = 'master';
		masterLabel.title = 'show or hide every kind';
		const spacer = document.createElement('span');
		spacer.className = 'swatch spacer';
		const text = document.createElement('span');
		text.textContent = 'all';
		masterLabel.append(master, spacer, text);
		container.appendChild(masterLabel);
	}

	for (const [kind, count] of counts) {
		const label = document.createElement('label');
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.dataset.kind = kind;
		checkbox.checked = hiddenSet.has(kind) === false;
		checkbox.addEventListener('change', () => {
			if (checkbox.checked === true) {
				hiddenSet.delete(kind);
			} else {
				hiddenSet.add(kind);
			}
			syncMaster();
			applyFilters();
		});
		childCheckboxes.push(checkbox);
		const swatch = document.createElement('span');
		swatch.className = 'swatch';
		swatch.style.background = colors[kind] ?? '#9ca3af';
		const text = document.createElement('span');
		text.textContent = kind;
		const countSpan = document.createElement('span');
		countSpan.className = 'count';
		countSpan.textContent = String(count);
		label.append(checkbox, swatch, text);
		const description = descriptions?.[kind];
		if (typeof description === 'string' && description.length > 0) {
			label.append(makeHelpBadge(kind, description));
		}
		label.append(countSpan);
		container.appendChild(label);
	}

	syncMaster();
}

/**
 * Builds the `?` help badge shown after a legend kind. Clicks are swallowed so
 * the badge never toggles the surrounding filter checkbox; hover and keyboard
 * focus reveal the shared tooltip with the kind's description.
 */
function makeHelpBadge(kind, description) {
	const badge = document.createElement('span');
	badge.className = 'help-badge';
	badge.textContent = '?';
	badge.tabIndex = 0;
	badge.setAttribute('role', 'img');
	badge.setAttribute('aria-label', `${kind}: ${description}`);
	badge.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	badge.addEventListener('mouseenter', () => showTooltip(badge, description));
	badge.addEventListener('mouseleave', hideTooltip);
	badge.addEventListener('focus', () => showTooltip(badge, description));
	badge.addEventListener('blur', hideTooltip);
	return badge;
}

/* ---------- hover tooltips ---------- */

let tooltipEl;

/** Lazily creates the single shared tooltip element, appended to <body> so the sidebar's overflow cannot clip it. */
function ensureTooltip() {
	if (tooltipEl === undefined) {
		tooltipEl = document.createElement('div');
		tooltipEl.className = 'kind-tooltip';
		tooltipEl.hidden = true;
		document.body.appendChild(tooltipEl);
	}
	return tooltipEl;
}

/** Shows the shared tooltip just below an anchor, flipping above / clamping horizontally to stay within the viewport. */
function showTooltip(anchor, text) {
	const tip = ensureTooltip();
	tip.textContent = text;
	tip.hidden = false;
	const rect = anchor.getBoundingClientRect();
	const margin = 8;
	let top = rect.bottom + 6;
	if (top + tip.offsetHeight > window.innerHeight - margin) {
		top = Math.max(margin, rect.top - tip.offsetHeight - 6);
	}
	const left = Math.max(margin, Math.min(rect.left, window.innerWidth - tip.offsetWidth - margin));
	tip.style.top = `${top}px`;
	tip.style.left = `${left}px`;
}

function hideTooltip() {
	if (tooltipEl !== undefined) {
		tooltipEl.hidden = true;
	}
}

function applyFilters() {
	const cy = state.cy;
	if (cy === undefined) {
		return;
	}
	cy.batch(() => {
		cy.nodes().forEach((node) => {
			const hiddenByKind = state.hiddenNodeKinds.has(node.data('kind')) === true;
			const unmeasured = node.data('runtime') === undefined || node.data('runtime') === null;
			const hiddenByMeasure = state.onlyMeasured === true && unmeasured === true;
			node.toggleClass('hidden', hiddenByKind === true || hiddenByMeasure === true);
		});
		cy.edges().forEach((edge) => {
			edge.toggleClass('hidden', state.hiddenEdgeKinds.has(edge.data('kind')) === true);
		});
		if (state.hideIsolated === true) {
			cy.nodes().not('.hidden').forEach((node) => {
				const hasVisibleEdge = node.connectedEdges().some((edge) =>
					edge.hasClass('hidden') === false
					&& edge.source().hasClass('hidden') === false
					&& edge.target().hasClass('hidden') === false);
				if (hasVisibleEdge === false) {
					node.addClass('hidden');
				}
			});
		}
	});
}

function countBy(values) {
	const counts = new Map();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- runtime ---------- */

/** Reads the `metadata.runtime` metrics off a raw node, or `undefined` if un-measured. */
function nodeRuntime(node) {
	if (node.metadata === undefined || node.metadata === null) {
		return undefined;
	}
	const runtime = node.metadata.runtime;
	return runtime === undefined || runtime === null ? undefined : runtime;
}

/** Maps a self-time to [0, 1] on a square-root scale so mid-range hotspots stay visible. */
function runtimeFraction(selfMs) {
	const max = state.runtime.maxSelfMs;
	if (max <= 0) {
		return 0;
	}
	return Math.sqrt(Math.max(0, selfMs ?? 0) / max);
}

/** Interpolates the heat ramp at the given fraction, returning an `rgb(...)` string. */
function heatColor(fraction) {
	const f = Math.min(1, Math.max(0, fraction));
	let lo = HEAT_STOPS[0];
	let hi = HEAT_STOPS[HEAT_STOPS.length - 1];
	for (let i = 0; i < HEAT_STOPS.length - 1; i += 1) {
		if (f >= HEAT_STOPS[i].at && f <= HEAT_STOPS[i + 1].at) {
			lo = HEAT_STOPS[i];
			hi = HEAT_STOPS[i + 1];
			break;
		}
	}
	const span = hi.at - lo.at || 1;
	const t = (f - lo.at) / span;
	const channel = (index) => Math.round(lo.color[index] + (hi.color[index] - lo.color[index]) * t);
	return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Human-readable self-time: seconds above 1 s, otherwise milliseconds. */
function formatMs(ms) {
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(1)} s`;
	}
	if (ms >= 1) {
		return `${ms.toFixed(0)} ms`;
	}
	return `${ms.toFixed(2)} ms`;
}

/** Centers and selects a node by id — shared by the hotspots list and search results. */
function focusNode(id) {
	const node = state.cy.getElementById(id);
	if (node.length === 1) {
		select(node);
		state.cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 350 });
	}
}

/** Renders the coverage line and the ranked hotspots list from the loaded runtime metrics. */
function renderRuntime() {
	const section = el('runtime');
	const toggle = el('runtime-heat');
	const measured = state.nodes
		.map((node) => ({ node, runtime: nodeRuntime(node) }))
		.filter((entry) => entry.runtime !== undefined)
		.sort((a, b) => (b.runtime.selfMs ?? 0) - (a.runtime.selfMs ?? 0));

	if (measured.length === 0) {
		section.classList.add('empty');
		el('coverage').textContent = 'no runtime data — run `enrich` to measure self-time';
		toggle.checked = false;
		toggle.disabled = true;
		state.encoding = 'structural';
		state.onlyMeasured = false;
		el('only-measured').checked = false;
		el('hotspots').innerHTML = '';
		if (state.cy !== undefined) {
			state.cy.style(cyStyle());
		}
		return;
	}

	section.classList.remove('empty');
	toggle.disabled = false;
	el('only-measured').disabled = false;
	el('coverage').textContent = `${state.runtime.measuredCount} / ${state.nodes.length} nodes measured · ${formatMs(state.runtime.totalSelfMs)} total self-time`;

	const list = el('hotspots');
	list.innerHTML = '';
	for (const { node, runtime } of measured.slice(0, HOTSPOTS_LIMIT)) {
		const row = document.createElement('div');
		row.className = 'hotspot';
		row.innerHTML = `<span class="heat-swatch" style="background:${heatColor(runtimeFraction(runtime.selfMs))}"></span><span class="hotspot-name">${escapeHtml(node.name)}</span><span class="hotspot-ms">${escapeHtml(formatMs(runtime.selfMs ?? 0))}</span>`;
		row.addEventListener('click', () => focusNode(node.id));
		list.appendChild(row);
	}
}

/* ---------- search ---------- */

function renderSearchResults() {
	const query = el('search').value.trim().toLowerCase();
	const container = el('search-results');
	container.innerHTML = '';
	if (query.length < 2) {
		return;
	}
	const hits = state.nodes
		.filter((node) => node.name.toLowerCase().includes(query) === true || node.filePath.toLowerCase().includes(query) === true)
		.slice(0, 15);
	for (const hit of hits) {
		const row = document.createElement('div');
		row.className = 'hit';
		row.innerHTML = `${escapeHtml(hit.name)} <span class="loc">${escapeHtml(hit.kind)} · ${escapeHtml(hit.filePath)}</span>`;
		row.addEventListener('click', () => focusNode(hit.id));
		container.appendChild(row);
	}
}

/* ---------- selection & details ---------- */

function select(node) {
	const cy = state.cy;
	cy.elements().addClass('faded').removeClass('sel');
	const hood = node.closedNeighborhood();
	hood.removeClass('faded');
	node.addClass('sel');
	renderDetails(node);
}

function clearSelection() {
	state.cy.elements().removeClass('faded sel');
	el('details-body').textContent = 'click a node';
}

/* Real source files we can link to GitHub; external modules, `process.env`, and API hosts carry synthetic paths. */
const SOURCE_FILE_PATTERN = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;

/**
 * Builds a GitHub permalink for a node's file at the analysed commit, or
 * `undefined` when no source was configured (server-side `--source`) or the path
 * is not a real source file. Line anchors are added only when a start line is known.
 */
function githubFileUrl(filePath, startLine) {
	const source = window.GRAPH_SOURCE;
	if (source === undefined || source === null || source.github === undefined) {
		return undefined;
	}
	if (typeof filePath !== 'string' || SOURCE_FILE_PATTERN.test(filePath) === false) {
		return undefined;
	}
	const { baseUrl, commit, prefix } = source.github;
	const encoded = `${prefix ?? ''}${filePath}`.split('/').map((segment) => encodeURIComponent(segment)).join('/');
	const anchor = startLine > 0 ? `#L${startLine}` : '';
	return `${baseUrl}/blob/${commit}/${encoded}${anchor}`;
}

function renderDetails(node) {
	const id = node.id();
	const color = NODE_COLORS[node.data('kind')] ?? '#9ca3af';
	const outgoing = state.edges.filter((edge) => edge.from === id);
	const incoming = state.edges.filter((edge) => edge.to === id);
	const nodeById = new Map(state.nodes.map((entry) => [entry.id, entry]));

	const renderEdgeRows = (edges, direction) => edges.map((edge) => {
		const otherId = direction === 'out' ? edge.to : edge.from;
		const other = nodeById.get(otherId);
		const name = other === undefined ? otherId : other.name;
		const arrow = direction === 'out' ? '→' : '←';
		const count = edgeCount(edge);
		const countBadge = count > 1 ? ` <span class="edge-count">×${count}</span>` : '';
		return `<div class="edge-row"><span class="edge-kind">${escapeHtml(edge.kind)}</span>${countBadge} ${arrow} <a data-target="${escapeHtml(otherId)}">${escapeHtml(name)}</a></div>`;
	}).join('');

	const runtime = node.data('runtime');
	const runtimeBlock = runtime === undefined || runtime === null ? '' : `
		<div class="runtime-block">
			<h3>runtime</h3>
			<div class="metric"><span>self-time</span><strong>${escapeHtml(formatMs(runtime.selfMs ?? 0))}</strong></div>
			<div class="metric"><span>samples</span><strong>${escapeHtml(String(runtime.samples ?? 0))}</strong></div>
			<div class="metric"><span>source</span><strong>${escapeHtml(String(runtime.source ?? '—'))}</strong></div>
		</div>`;

	const filePath = node.data('filePath');
	const startLine = node.data('startLine');
	const locationText = `${filePath}${startLine > 0 ? ':' + startLine : ''}`;
	const fileUrl = githubFileUrl(filePath, startLine);
	const locationHtml = fileUrl === undefined
		? escapeHtml(locationText)
		: `<a class="file-link" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer" title="open on GitHub">${escapeHtml(locationText)}</a>`;

	el('details-body').innerHTML = `
		<div><span class="kind-tag" style="background:${color}">${escapeHtml(node.data('kind'))}</span> <strong>${escapeHtml(node.data('name'))}</strong></div>
		<div>${locationHtml}</div>
		<div class="id">${escapeHtml(id)}</div>
		${runtimeBlock}
		<h3>outgoing (${outgoing.length})</h3>${renderEdgeRows(outgoing, 'out')}
		<h3>incoming (${incoming.length})</h3>${renderEdgeRows(incoming, 'in')}
	`;
	el('details-body').querySelectorAll('a[data-target]').forEach((link) => {
		link.addEventListener('click', () => {
			const target = state.cy.getElementById(link.dataset.target);
			if (target.length === 1) {
				select(target);
				state.cy.animate({ center: { eles: target } }, { duration: 300 });
			}
		});
	});
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

boot();
