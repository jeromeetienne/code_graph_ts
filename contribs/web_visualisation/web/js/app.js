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
};

const state = {
	nodes: [],
	edges: [],
	cy: undefined,
	hiddenNodeKinds: new Set(),
	hiddenEdgeKinds: new Set(),
	hideIsolated: false,
	droppedFiles: { nodes: undefined, edges: undefined },
};

const el = (id) => document.getElementById(id);

/* ---------- data loading ---------- */

function boot() {
	setupDropzone();
	el('hide-isolated').addEventListener('change', (event) => {
		state.hideIsolated = event.target.checked;
		applyFilters();
	});
	el('relayout').addEventListener('click', () => runLayout());
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

	const elements = [
		...nodes.map((node) => ({
			group: 'nodes',
			data: { id: node.id, name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.range === undefined ? 0 : node.range.startLine, exported: node.exported === true, degree: degree.get(node.id) ?? 0 },
		})),
		...edges
			.filter((edge) => nodeIds.has(edge.from) === true && nodeIds.has(edge.to) === true)
			.map((edge) => ({
				group: 'edges',
				data: { id: edge.id, source: edge.from, target: edge.to, kind: edge.kind },
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
	applyFilters();
	el('status').textContent = `${sourceLabel} — ${nodes.length} nodes, ${edges.length} edges`;
}

function cyStyle() {
	return [
		{
			selector: 'node',
			style: {
				'background-color': (node) => NODE_COLORS[node.data('kind')] ?? '#9ca3af',
				'width': (node) => 8 + Math.sqrt(node.data('degree')) * 4,
				'height': (node) => 8 + Math.sqrt(node.data('degree')) * 4,
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
				'width': 1,
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
		{ selector: 'node.sel', style: { 'border-width': 3, 'border-color': '#ffffff' } },
	];
}

function runLayout() {
	const name = el('layout-select').value;
	const options = name === 'concentric'
		? { name, concentric: (node) => node.degree(), levelWidth: () => 2, animate: false, padding: 30 }
		: { name, animate: false, padding: 30 };
	state.cy.elements(':visible').layout(options).run();
}

/* ---------- legends & filtering ---------- */

function buildLegends() {
	const nodeCounts = countBy(state.nodes.map((node) => node.kind));
	const edgeCounts = countBy(state.edges.map((edge) => edge.kind));
	renderLegend(el('node-kinds'), nodeCounts, NODE_COLORS, state.hiddenNodeKinds);
	renderLegend(el('edge-kinds'), edgeCounts, EDGE_COLORS, state.hiddenEdgeKinds);
}

function renderLegend(container, counts, colors, hiddenSet) {
	container.innerHTML = '';
	for (const [kind, count] of counts) {
		const label = document.createElement('label');
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = hiddenSet.has(kind) === false;
		checkbox.addEventListener('change', () => {
			if (checkbox.checked === true) {
				hiddenSet.delete(kind);
			} else {
				hiddenSet.add(kind);
			}
			applyFilters();
		});
		const swatch = document.createElement('span');
		swatch.className = 'swatch';
		swatch.style.background = colors[kind] ?? '#9ca3af';
		const text = document.createElement('span');
		text.textContent = kind;
		const countSpan = document.createElement('span');
		countSpan.className = 'count';
		countSpan.textContent = String(count);
		label.append(checkbox, swatch, text, countSpan);
		container.appendChild(label);
	}
}

function applyFilters() {
	const cy = state.cy;
	if (cy === undefined) {
		return;
	}
	cy.batch(() => {
		cy.nodes().forEach((node) => {
			node.toggleClass('hidden', state.hiddenNodeKinds.has(node.data('kind')) === true);
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
		row.addEventListener('click', () => {
			const node = state.cy.getElementById(hit.id);
			if (node.length === 1) {
				select(node);
				state.cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 350 });
			}
		});
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
		return `<div class="edge-row"><span class="edge-kind">${escapeHtml(edge.kind)}</span> ${arrow} <a data-target="${escapeHtml(otherId)}">${escapeHtml(name)}</a></div>`;
	}).join('');

	el('details-body').innerHTML = `
		<div><span class="kind-tag" style="background:${color}">${escapeHtml(node.data('kind'))}</span> <strong>${escapeHtml(node.data('name'))}</strong></div>
		<div>${escapeHtml(node.data('filePath'))}${node.data('startLine') > 0 ? ':' + node.data('startLine') : ''}</div>
		<div class="id">${escapeHtml(id)}</div>
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
