// @ts-check
'use strict';

/** @type {Record<string, string>} */
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

/** @type {Record<string, string>} */
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
	CALLS_RUNTIME: '#be123c',
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

const HOTSPOTS_LIMIT = 12;

/* Persisted theme override ('light' | 'dark'); absent means follow the OS. */
const THEME_STORAGE_KEY = 'ktg.theme';

/** @type {AppState} */
const state = {
	nodes: [],
	edges: [],
	cy: undefined,
	hiddenNodeKinds: new Set(),
	hiddenEdgeKinds: new Set(),
	hiddenCommunities: new Set(),
	hideIsolated: false,
	onlyMeasured: false,
	droppedFiles: { nodes: undefined, edges: undefined },
	encoding: 'structural',
	runtime: { maxSelfMs: 0, measuredCount: 0, totalSelfMs: 0 },
	communities: [],
	communityLabels: new Map(),
};

/**
 * Looks up a required element by id, throwing when it is absent so a missing
 * template node fails loudly here instead of as a later `null` dereference.
 * @param {string} id
 * @returns {HTMLElement}
 */
const el = (id) => {
	const element = document.getElementById(id);
	if (element === null) {
		throw new Error(`missing element #${id}`);
	}
	return element;
};

/**
 * Looks up a required `<input>` by id, narrowing it so `.checked` / `.value` are typed.
 * @param {string} id
 * @returns {HTMLInputElement}
 */
const inputEl = (id) => {
	const element = el(id);
	if ((element instanceof HTMLInputElement) === false) {
		throw new Error(`element #${id} is not an input`);
	}
	return element;
};

/**
 * Looks up a required `<select>` by id, narrowing it so `.value` is typed.
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
const selectEl = (id) => {
	const element = el(id);
	if ((element instanceof HTMLSelectElement) === false) {
		throw new Error(`element #${id} is not a select`);
	}
	return element;
};

/**
 * Narrows a change/input event target to an `<input>` so `.checked` / `.value`
 * can be read inside handlers bound to known controls.
 * @param {EventTarget | null} target
 * @returns {HTMLInputElement}
 */
const asInput = (target) => {
	if ((target instanceof HTMLInputElement) === false) {
		throw new Error('event target is not an input');
	}
	return target;
};

/**
 * Narrows a change-event target to a `<select>` so `.value` can be read inside
 * the encoding-selector handler.
 * @param {EventTarget | null} target
 * @returns {HTMLSelectElement}
 */
const asSelect = (target) => {
	if ((target instanceof HTMLSelectElement) === false) {
		throw new Error('event target is not a select');
	}
	return target;
};

/* ---------- data loading ---------- */

function boot() {
	setupDropzone();
	setupFolds();
	setupTheme();
	el('hide-isolated').addEventListener('change', (event) => {
		state.hideIsolated = asInput(event.target).checked;
		applyFilters();
	});
	el('relayout').addEventListener('click', () => runLayout());
	el('encoding-select').addEventListener('change', (event) => {
		state.encoding = encodingFromValue(asSelect(event.target).value);
		if (state.cy !== undefined) {
			state.cy.style(cyStyle());
		}
	});
	el('only-measured').addEventListener('change', (event) => {
		state.onlyMeasured = asInput(event.target).checked;
		applyFilters();
	});
	el('search').addEventListener('input', () => renderSearchResults());
	el('search').addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			const first = /** @type {HTMLElement | null} */ (document.querySelector('#search-results .hit'));
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

/**
 * Parses newline-delimited JSON into records. The records cross an untyped
 * deserialisation boundary, so callers narrow them via the `setData` signature.
 * @param {string} text
 * @returns {any[]}
 */
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
		if (event.dataTransfer === null) {
			return;
		}
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

/**
 * Reads the persisted collapsed-by-key map, tolerating absent or malformed storage.
 * @returns {Record<string, boolean>}
 */
function loadFolds() {
	try {
		const raw = localStorage.getItem(FOLD_STORAGE_KEY);
		const parsed = raw === null ? {} : JSON.parse(raw);
		return parsed !== null && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Persists the collapsed-by-key map; a no-op when storage is unavailable (private mode, file://).
 * @param {Record<string, boolean>} folds
 */
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
	for (const rawHeader of document.querySelectorAll('#sidebar .foldable')) {
		const header = /** @type {HTMLElement} */ (rawHeader);
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

/* ---------- theme ---------- */

/**
 * Reads a CSS custom property off the document root, trimmed. The Cytoscape
 * style pulls its theme-dependent colours from the same variables the stylesheet
 * uses, so switching theme is a single attribute flip plus a graph re-style.
 * @param {string} name
 * @returns {string}
 */
function cssVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Reads the persisted theme override, or `null` when none is set or storage is unavailable.
 * @returns {'light' | 'dark' | null}
 */
function storedTheme() {
	try {
		const value = localStorage.getItem(THEME_STORAGE_KEY);
		return value === 'light' || value === 'dark' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Resolves the active theme: an explicit stored choice wins, otherwise the OS
 * `prefers-color-scheme`, otherwise dark.
 * @returns {'light' | 'dark'}
 */
function resolveTheme() {
	const stored = storedTheme();
	if (stored !== null) {
		return stored;
	}
	return window.matchMedia('(prefers-color-scheme: light)').matches === true ? 'light' : 'dark';
}

/**
 * Applies a theme: flips the `data-theme` attribute the stylesheet keys off,
 * updates the toggle glyph, and re-styles the graph so its canvas-drawn colours
 * (labels, selection ring, node borders) track the theme.
 * @param {'light' | 'dark'} theme
 */
function applyTheme(theme) {
	document.documentElement.setAttribute('data-theme', theme);
	const toggle = el('theme-toggle');
	toggle.textContent = theme === 'dark' ? '☀' : '☾';
	toggle.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
	if (state.cy !== undefined) {
		state.cy.style(cyStyle());
	}
}

/**
 * Wires the theme toggle: clicking persists and applies the opposite theme, and
 * — while no explicit choice is stored — the viewer follows later OS changes.
 */
function setupTheme() {
	applyTheme(resolveTheme());
	el('theme-toggle').addEventListener('click', () => {
		const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
		try {
			localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			/* storage unavailable (private mode, file://) — apply for this session only */
		}
		applyTheme(next);
	});
	window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
		if (storedTheme() === null) {
			applyTheme(event.matches === true ? 'light' : 'dark');
		}
	});
}

/* ---------- graph construction ---------- */

/**
 * @param {RawNode[]} nodes
 * @param {RawEdge[]} edges
 * @param {string} sourceLabel
 */
function setData(nodes, edges, sourceLabel) {
	state.nodes = nodes;
	state.edges = edges;

	const nodeIds = new Set(nodes.map((node) => node.id));
	/** @type {Map<string, number>} */
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
	state.communities = communityCounts(nodes);
	state.communityLabels = communityLabels(nodes);

	const elements = [
		...nodes.map((node) => ({
			group: 'nodes',
			data: { id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.range === undefined ? 0 : node.range.startLine, exported: node.exported === true, degree: degree.get(node.id) ?? 0, runtime: nodeRuntime(node), community: nodeCommunity(node) },
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
	renderCommunities();
	syncEncodingOptions();
	applyFilters();
	el('status').textContent = `${sourceLabel} — ${nodes.length} nodes, ${edges.length} edges`;
}

function cyStyle() {
	const unmeasuredFill = cssVar('--unmeasured-fill');
	const unmeasuredBorder = cssVar('--unmeasured-border');
	const nodeBorder = cssVar('--graph-node-border');
	const nodeBorderWidth = parseFloat(cssVar('--graph-node-border-width')) || 0;
	const labelColor = cssVar('--graph-label');
	const labelBg = cssVar('--graph-label-bg');
	const selBorder = cssVar('--graph-sel-border');
	/** @param {CyCollection} node */
	const nodeColor = (node) => {
		if (state.encoding === 'runtime') {
			const runtime = node.data('runtime');
			return runtime === undefined || runtime === null ? unmeasuredFill : heatColor(runtimeFraction(runtime.selfMs));
		}
		if (state.encoding === 'community') {
			const community = node.data('community');
			return community === undefined || community === null ? unmeasuredFill : communityColor(community);
		}
		return NODE_COLORS[node.data('kind')] ?? '#9ca3af';
	};
	/** @param {CyCollection} node */
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
	/**
	 * Whether the active encoding has no value for this node — un-measured in
	 * runtime mode, or unassigned to a community in community mode. Such nodes get
	 * the muted fill and a dashed border so the gap reads as "no data", not a colour.
	 * @param {CyCollection} node
	 */
	const isUnencoded = (node) =>
		(state.encoding === 'runtime' && (node.data('runtime') === undefined || node.data('runtime') === null))
		|| (state.encoding === 'community' && (node.data('community') === undefined || node.data('community') === null));
	return [
		{
			selector: 'node',
			style: {
				'background-color': nodeColor,
				'width': nodeSize,
				'height': nodeSize,
				'border-width': (/** @type {CyCollection} */ node) => isUnencoded(node) === true ? 1 : nodeBorderWidth,
				'border-color': (/** @type {CyCollection} */ node) => isUnencoded(node) === true ? unmeasuredBorder : nodeBorder,
				'border-style': (/** @type {CyCollection} */ node) => isUnencoded(node) === true ? 'dashed' : 'solid',
				'label': 'data(name)',
				'color': labelColor,
				'font-size': 8,
				'min-zoomed-font-size': 7,
				'text-valign': 'bottom',
				'text-margin-y': 3,
				'text-background-color': labelBg,
				'text-background-opacity': 0.85,
				'text-background-shape': 'roundrectangle',
				'text-background-padding': 2,
			},
		},
		{
			selector: 'edge',
			style: {
				'width': (/** @type {CyCollection} */ edge) => edgeWidth(edge.data('count')),
				'line-color': (/** @type {CyCollection} */ edge) => EDGE_COLORS[edge.data('kind')] ?? '#475569',
				'target-arrow-color': (/** @type {CyCollection} */ edge) => EDGE_COLORS[edge.data('kind')] ?? '#475569',
				'target-arrow-shape': 'triangle',
				'arrow-scale': 0.6,
				'curve-style': 'bezier',
				'opacity': 0.65,
			},
		},
		{ selector: '.hidden', style: { display: 'none' } },
		{ selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0, 'text-background-opacity': 0 } },
		{ selector: 'node.sel', style: { 'border-width': 3, 'border-color': selBorder, 'border-style': 'solid' } },
	];
}

function runLayout() {
	const cy = state.cy;
	if (cy === undefined) {
		return;
	}
	const name = selectEl('layout-select').value;
	const options = name === 'concentric'
		? { name, concentric: (/** @type {CyCollection} */ node) => node.degree(), levelWidth: () => 2, animate: false, padding: 30 }
		: { name, animate: false, padding: 30 };
	cy.elements(':visible').layout(options).run();
}

/* ---------- edge weighting ---------- */

/**
 * Reads the call-site multiplicity off a raw edge's metadata; defaults to 1 when absent.
 * @param {RawEdge} edge
 * @returns {number}
 */
function edgeCount(edge) {
	if (edge.metadata === undefined || edge.metadata === null) {
		return 1;
	}
	const count = edge.metadata.count;
	return typeof count === 'number' && count > 0 ? count : 1;
}

/**
 * Maps a call-site count to a stroke width: count 1 keeps the baseline, higher counts thicken sub-linearly.
 * @param {number} count
 * @returns {number}
 */
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

/**
 * @param {HTMLElement} container
 * @param {[string, number][]} counts
 * @param {Record<string, string>} colors
 * @param {Set<string>} hiddenSet
 * @param {Record<string, string>} descriptions
 */
function renderLegend(container, counts, colors, hiddenSet, descriptions) {
	container.innerHTML = '';
	const kinds = counts.map(([kind]) => kind);
	/** @type {HTMLInputElement[]} */
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
				child.checked = hiddenSet.has(child.dataset.kind ?? '') === false;
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
 * @param {string} kind
 * @param {string} description
 * @returns {HTMLSpanElement}
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

/** @type {HTMLElement | undefined} */
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

/**
 * Shows the shared tooltip just below an anchor, flipping above / clamping horizontally to stay within the viewport.
 * @param {HTMLElement} anchor
 * @param {string} text
 */
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
			const community = node.data('community');
			const hiddenByCommunity = community !== undefined && community !== null && state.hiddenCommunities.has(community) === true;
			node.toggleClass('hidden', hiddenByKind === true || hiddenByMeasure === true || hiddenByCommunity === true);
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

/**
 * @param {string[]} values
 * @returns {[string, number][]}
 */
function countBy(values) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- runtime ---------- */

/**
 * Reads the `metadata.runtime` metrics off a raw node, or `undefined` if un-measured.
 * @param {RawNode} node
 * @returns {NodeRuntime | undefined}
 */
function nodeRuntime(node) {
	if (node.metadata === undefined || node.metadata === null) {
		return undefined;
	}
	const runtime = node.metadata.runtime;
	return runtime === undefined || runtime === null ? undefined : runtime;
}

/**
 * Maps a self-time to [0, 1] on a square-root scale so mid-range hotspots stay visible.
 * @param {number | undefined} selfMs
 * @returns {number}
 */
function runtimeFraction(selfMs) {
	const max = state.runtime.maxSelfMs;
	if (max <= 0) {
		return 0;
	}
	return Math.sqrt(Math.max(0, selfMs ?? 0) / max);
}

/**
 * Interpolates the heat ramp at the given fraction, returning an `rgb(...)` string.
 * @param {number} fraction
 * @returns {string}
 */
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
	/** @param {number} index */
	const channel = (index) => Math.round(lo.color[index] + (hi.color[index] - lo.color[index]) * t);
	return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/**
 * Human-readable self-time: seconds above 1 s, otherwise milliseconds.
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(1)} s`;
	}
	if (ms >= 1) {
		return `${ms.toFixed(0)} ms`;
	}
	return `${ms.toFixed(2)} ms`;
}

/**
 * Centers and selects a node by id — shared by the hotspots list and search results.
 * @param {string} id
 */
function focusNode(id) {
	const cy = state.cy;
	if (cy === undefined) {
		return;
	}
	const node = cy.getElementById(id);
	if (node.length === 1) {
		select(node);
		cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 350 });
	}
}

/** Renders the coverage line and the ranked hotspots list from the loaded runtime metrics. */
function renderRuntime() {
	const section = el('runtime');
	const measured = state.nodes
		.map((node) => ({ node, runtime: nodeRuntime(node) }))
		.filter((entry) => entry.runtime !== undefined)
		.sort((a, b) => (b.runtime?.selfMs ?? 0) - (a.runtime?.selfMs ?? 0));

	if (measured.length === 0) {
		section.classList.add('empty');
		el('coverage').textContent = 'no runtime data — run `enrich` to measure self-time';
		state.onlyMeasured = false;
		inputEl('only-measured').checked = false;
		el('hotspots').innerHTML = '';
		return;
	}

	section.classList.remove('empty');
	inputEl('only-measured').disabled = false;
	el('coverage').textContent = `${state.runtime.measuredCount} / ${state.nodes.length} nodes measured · ${formatMs(state.runtime.totalSelfMs)} total self-time`;

	const list = el('hotspots');
	list.innerHTML = '';
	for (const { node, runtime } of measured.slice(0, HOTSPOTS_LIMIT)) {
		const row = document.createElement('div');
		row.className = 'hotspot';
		row.innerHTML = `<span class="heat-swatch" style="background:${heatColor(runtimeFraction(runtime?.selfMs))}"></span><span class="hotspot-name">${escapeHtml(node.name)}</span><span class="hotspot-ms">${escapeHtml(formatMs(runtime?.selfMs ?? 0))}</span>`;
		row.addEventListener('click', () => focusNode(node.id));
		list.appendChild(row);
	}
}

/* ---------- community ---------- */

/**
 * Reads the integer community index `cluster` attaches as `metadata.community`,
 * or `undefined` when the graph has not been clustered.
 * @param {RawNode} node
 * @returns {number | undefined}
 */
function nodeCommunity(node) {
	if (node.metadata === undefined || node.metadata === null) {
		return undefined;
	}
	const community = node.metadata.community;
	return typeof community === 'number' ? community : undefined;
}

/**
 * Reads the human-readable community label `cluster` attaches as
 * `metadata.communityLabel`. Every clustered node carries one, written alongside
 * its community index, so this is defined whenever {@link nodeCommunity} is.
 * @param {RawNode} node
 * @returns {string | undefined}
 */
function nodeCommunityLabel(node) {
	if (node.metadata === undefined || node.metadata === null) {
		return undefined;
	}
	const label = node.metadata.communityLabel;
	return typeof label === 'string' ? label : undefined;
}

/**
 * A stable, theme-independent colour per community index, spread around the hue
 * circle by the golden angle so adjacent indices stay distinct. Fixed
 * saturation/lightness keep it legible on both the light and dark canvas, like
 * the kind palette.
 * @param {number} index
 * @returns {string}
 */
function communityColor(index) {
	const hue = Math.round((index * 137.508) % 360);
	return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Counts members per community across the loaded nodes, as `[index, count]`
 * pairs sorted by size descending (the order `cluster` reports them in).
 * @param {RawNode[]} nodes
 * @returns {[number, number][]}
 */
function communityCounts(nodes) {
	/** @type {Map<number, number>} */
	const counts = new Map();
	for (const node of nodes) {
		const community = nodeCommunity(node);
		if (community !== undefined) {
			counts.set(community, (counts.get(community) ?? 0) + 1);
		}
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Maps each community index to its label, read from the first member node seen —
 * `cluster` writes the same label onto every member, so one read per community
 * suffices.
 * @param {RawNode[]} nodes
 * @returns {Map<number, string>}
 */
function communityLabels(nodes) {
	/** @type {Map<number, string>} */
	const labels = new Map();
	for (const node of nodes) {
		const community = nodeCommunity(node);
		if (community === undefined || labels.has(community) === true) {
			continue;
		}
		const label = nodeCommunityLabel(node);
		if (label !== undefined) {
			labels.set(community, label);
		}
	}
	return labels;
}

/**
 * Renders the Communities legend as visibility filters — a checkbox + swatch +
 * member count per community, plus a master "all" toggle — so a community can be
 * shown or hidden on the graph, mirroring the node/edge kind legends. The section
 * is hidden when the graph is un-clustered.
 */
function renderCommunities() {
	const section = el('communities');
	const container = el('community-legend');
	container.innerHTML = '';
	if (state.communities.length === 0) {
		section.classList.add('empty');
		return;
	}
	section.classList.remove('empty');

	const indices = state.communities.map(([index]) => index);
	/** @type {HTMLInputElement[]} */
	const childCheckboxes = [];

	const master = document.createElement('input');
	master.type = 'checkbox';
	const syncMaster = () => {
		const hiddenCount = indices.filter((index) => state.hiddenCommunities.has(index) === true).length;
		master.checked = hiddenCount === 0;
		master.indeterminate = hiddenCount > 0 && hiddenCount < indices.length;
	};
	master.addEventListener('change', () => {
		const allVisible = indices.every((index) => state.hiddenCommunities.has(index) === false);
		for (const index of indices) {
			if (allVisible === true) {
				state.hiddenCommunities.add(index);
			} else {
				state.hiddenCommunities.delete(index);
			}
		}
		for (const child of childCheckboxes) {
			child.checked = state.hiddenCommunities.has(Number(child.dataset.community)) === false;
		}
		syncMaster();
		applyFilters();
	});
	const masterLabel = document.createElement('label');
	masterLabel.className = 'master';
	masterLabel.title = 'show or hide every community';
	const spacer = document.createElement('span');
	spacer.className = 'swatch spacer';
	const masterText = document.createElement('span');
	masterText.textContent = 'all';
	masterLabel.append(master, spacer, masterText);
	container.appendChild(masterLabel);

	for (const [index, count] of state.communities) {
		const row = document.createElement('label');
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.dataset.community = String(index);
		checkbox.checked = state.hiddenCommunities.has(index) === false;
		checkbox.addEventListener('change', () => {
			if (checkbox.checked === true) {
				state.hiddenCommunities.delete(index);
			} else {
				state.hiddenCommunities.add(index);
			}
			syncMaster();
			applyFilters();
		});
		childCheckboxes.push(checkbox);
		const swatch = document.createElement('span');
		swatch.className = 'swatch';
		swatch.style.background = communityColor(index);
		const text = document.createElement('span');
		text.textContent = /** @type {string} */ (state.communityLabels.get(index));
		const countSpan = document.createElement('span');
		countSpan.className = 'count';
		countSpan.textContent = String(count);
		row.append(checkbox, swatch, text, countSpan);
		container.appendChild(row);
	}

	syncMaster();
}

/**
 * Enables the `self-time` and `community` colour modes only when the loaded
 * graph carries that data, falls back to `structural` if the active mode lost
 * its data, mirrors the choice into the `<select>`, and re-applies the style.
 */
function syncEncodingOptions() {
	const select = selectEl('encoding-select');
	/**
	 * @param {string} value
	 * @param {boolean} enabled
	 */
	const setEnabled = (value, enabled) => {
		const option = select.querySelector(`option[value="${value}"]`);
		if (option instanceof HTMLOptionElement) {
			option.disabled = enabled === false;
		}
	};
	setEnabled('runtime', state.runtime.measuredCount > 0);
	setEnabled('community', state.communities.length > 0);
	if ((state.encoding === 'runtime' && state.runtime.measuredCount === 0)
		|| (state.encoding === 'community' && state.communities.length === 0)) {
		state.encoding = 'structural';
	}
	select.value = state.encoding;
	if (state.cy !== undefined) {
		state.cy.style(cyStyle());
	}
}

/**
 * Narrows an arbitrary `<select>` value to a known encoding mode, defaulting to `structural`.
 * @param {string} value
 * @returns {'structural' | 'runtime' | 'community'}
 */
function encodingFromValue(value) {
	return value === 'runtime' || value === 'community' ? value : 'structural';
}

/* ---------- search ---------- */

function renderSearchResults() {
	const query = inputEl('search').value.trim().toLowerCase();
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

/** @param {CyCollection} node */
function select(node) {
	const cy = state.cy;
	if (cy === undefined) {
		return;
	}
	cy.elements().addClass('faded').removeClass('sel');
	const hood = node.closedNeighborhood();
	hood.removeClass('faded');
	node.addClass('sel');
	renderDetails(node);
}

function clearSelection() {
	if (state.cy !== undefined) {
		state.cy.elements().removeClass('faded sel');
	}
	el('details-body').textContent = 'click a node';
}

/* Real source files we can link to GitHub; external modules, `process.env`, and API hosts carry synthetic paths. */
const SOURCE_FILE_PATTERN = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;

/**
 * Builds a GitHub permalink for a node's file at the analysed commit, or
 * `undefined` when no source was configured (server-side `--source`) or the path
 * is not a real source file. Line anchors are added only when a start line is known.
 * @param {unknown} filePath
 * @param {number} startLine
 * @returns {string | undefined}
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

/** @param {CyCollection} node */
function renderDetails(node) {
	const id = node.id();
	const color = NODE_COLORS[node.data('kind')] ?? '#9ca3af';
	const outgoing = state.edges.filter((edge) => edge.from === id);
	const incoming = state.edges.filter((edge) => edge.to === id);
	const nodeById = new Map(state.nodes.map((entry) => /** @type {[string, RawNode]} */ ([entry.id, entry])));

	/**
	 * @param {RawEdge[]} edges
	 * @param {'out' | 'in'} direction
	 */
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
			const cy = state.cy;
			if (cy === undefined) {
				return;
			}
			const anchor = /** @type {HTMLElement} */ (link);
			const target = cy.getElementById(anchor.dataset.target ?? '');
			if (target.length === 1) {
				select(target);
				cy.animate({ center: { eles: target } }, { duration: 300 });
			}
		});
	});
}

const ESCAPE_REPLACEMENTS = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ESCAPE_REPLACEMENTS[char]);
}

boot();
