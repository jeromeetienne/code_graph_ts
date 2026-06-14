/**
 * Ambient declarations for the static web viewer (`web/js/app.js`).
 *
 * The page ships as plain, build-free JavaScript and is type-checked in place
 * with `// @ts-check`. This file gives that JavaScript precise types for the
 * data it loads (the knowledge-graph JSONL records, mirrored from
 * `src/schema`), and a deliberately loose surface for the Cytoscape.js library,
 * which is loaded as a global from a CDN and has no bundled types here.
 */

/* ---------- knowledge-graph data (mirrors src/schema) ---------- */

/** Source range of a symbol; mirrors `RangeSchema` in `src/schema/node.ts`. */
interface RawRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

/** Per-node runtime metrics attached by `enrich`, read from `metadata.runtime`. */
interface NodeRuntime {
	selfMs?: number;
	samples?: number;
	source?: string;
}

/** A graph node as serialised in `nodes.jsonl`; mirrors `GraphNodeSchema`. */
interface RawNode {
	id: string;
	kind: string;
	name: string;
	filePath: string;
	range?: RawRange;
	exported?: boolean;
	metadata?: { runtime?: NodeRuntime | null; community?: number | null; communityLabel?: string | null; [key: string]: unknown } | null;
}

/** A graph edge as serialised in `edges.jsonl`; mirrors `GraphEdgeSchema`. */
interface RawEdge {
	id: string;
	kind: string;
	from: string;
	to: string;
	metadata?: { count?: number; [key: string]: unknown } | null;
}

/** The embedded `window.GRAPH_DATA` payload written by `scripts/build-data.ts`. */
interface GraphData {
	nodes: RawNode[];
	edges: RawEdge[];
}

/** The `window.KIND_DESCRIPTIONS` payload: one-line help per node/edge kind. */
interface KindDescriptions {
	nodes: Record<string, string>;
	edges: Record<string, string>;
}

/** GitHub permalink descriptor; mirrors `GitHubSource` in `src/commands/webview_command.ts`. */
interface GitHubSource {
	baseUrl: string;
	commit: string;
	prefix: string;
}

/** The `window.GRAPH_SOURCE` payload injected by the `web` command. */
interface GraphSource {
	github?: GitHubSource;
}

/** The single mutable view-model the viewer threads through its render functions. */
interface AppState {
	nodes: RawNode[];
	edges: RawEdge[];
	cy: CyCore | undefined;
	hiddenNodeKinds: Set<string>;
	hiddenEdgeKinds: Set<string>;
	hiddenCommunities: Set<number>;
	hideIsolated: boolean;
	onlyMeasured: boolean;
	droppedFiles: { nodes: RawNode[] | undefined; edges: RawEdge[] | undefined };
	encoding: 'structural' | 'runtime' | 'community';
	runtime: { maxSelfMs: number; measuredCount: number; totalSelfMs: number };
	communities: [number, number][];
	communityLabels: Map<number, string>;
	history: string[];
	historyIndex: number;
}

/* ---------- Cytoscape.js (loaded as a CDN global, untyped) ---------- */

/**
 * A Cytoscape collection or single element. Only the surface the viewer uses is
 * declared. `data()` is intentionally `any`: it is Cytoscape's dynamic per-element
 * bag and the one place this otherwise-strict file crosses an untyped boundary.
 */
interface CyCollection {
	length: number;
	data(name?: string): any;
	id(): string;
	degree(): number;
	closedNeighborhood(): CyCollection;
	connectedEdges(): CyCollection;
	source(): CyCollection;
	target(): CyCollection;
	addClass(names: string): CyCollection;
	removeClass(names: string): CyCollection;
	toggleClass(names: string, flag?: boolean): CyCollection;
	hasClass(name: string): boolean;
	not(selector: string): CyCollection;
	forEach(each: (element: CyCollection, index: number) => void): void;
	some(test: (element: CyCollection, index: number) => boolean): boolean;
	layout(options: unknown): { run(): CyCollection };
}

/** A Cytoscape event; `target` is the element or core the event fired on. */
interface CyEvent {
	target: any;
}

/** The Cytoscape core instance returned by the `cytoscape(...)` factory. */
interface CyCore {
	destroy(): void;
	on(events: string, handler: (event: CyEvent) => void): CyCore;
	on(events: string, selector: string, handler: (event: CyEvent) => void): CyCore;
	style(style?: unknown): CyCore;
	elements(selector?: string): CyCollection;
	nodes(selector?: string): CyCollection;
	edges(selector?: string): CyCollection;
	batch(callback: () => void): void;
	getElementById(id: string): CyCollection;
	animate(options: unknown, params?: unknown): CyCore;
}

interface CytoscapeOptions {
	container?: HTMLElement | null;
	elements?: unknown;
	style?: unknown;
	layout?: unknown;
}

declare function cytoscape(options?: CytoscapeOptions): CyCore;
declare namespace cytoscape {
	/** Registers a Cytoscape extension (such as the fcose layout) loaded as a CDN global. */
	function use(extension: unknown): void;
}

/* ---------- globals injected into the page ---------- */

interface Window {
	GRAPH_DATA?: GraphData;
	KIND_DESCRIPTIONS?: KindDescriptions;
	GRAPH_SOURCE?: GraphSource | null;
	cytoscapeFcose?: unknown;
}
