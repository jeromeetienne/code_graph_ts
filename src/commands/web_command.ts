import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { GitSource } from '../extract/git_source.js';
import { SOURCE_MANIFEST_KEY, SourceManifest, SourceManifestSchema } from '../schema/source_manifest.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH } from './command_helpers.js';

/**
 * Static assets of the web visualisation, resolved relative to this module so
 * the same path works from `src/` (tsx) and from `dist/` (published package).
 */
const WEB_ROOT = fileURLToPath(new URL('../../contribs/webview/web', import.meta.url));

const DATA_SCRIPT_PATH = '/data/graph_data.js';
const DEFAULT_PORT = '4173';

const MIME_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
};

type WebOptions = {
	db: string;
	port: string;
	source: string;
};

/**
 * `webview` command — serves the knowledge graph database in an interactive web
 * visualisation. The graph is read from Kùzu once at startup and injected into
 * the page as `/data/graph_data.js`; all other assets are served statically
 * from the contribs/webview/web directory.
 */
export class WebCommand {
	static register(program: Command): void {
		program
			.command('webview')
			.description('serve the knowledge graph database in a web visualisation')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('-p, --port <port>', 'HTTP port to listen on', DEFAULT_PORT)
			.option('-s, --source <dir>', 'fallback project root for GitHub links when the graph records no source', '.')
			.action(async (options: WebOptions) => {
				await WebCommand.run(options);
			});
	}

	private static async run(options: WebOptions): Promise<void> {
		const dbPath = resolve(options.db);
		if (existsSync(dbPath) === false) {
			console.error(chalk.red(`database not found at ${dbPath} — run \`extract\` then \`load\` first`));
			process.exitCode = 1;
			return;
		}

		const github = await WebCommand.resolveGitHubSource(dbPath, resolve(options.source));
		const sourceScript = github === undefined ? '' : `window.GRAPH_SOURCE = ${JSON.stringify({ github })};\n`;
		const dataScript = sourceScript + await WebCommand.buildDataScript(dbPath);

		const server = createServer((request, response) => {
			void WebCommand.handle(request, response, dataScript);
		});
		server.listen(Number(options.port), () => {
			console.log(chalk.green(`✓ serving the knowledge graph at http://localhost:${options.port}/`));
			console.log(chalk.gray('  press Ctrl+C to stop'));
		});
	}

	/**
	 * Reads every node and edge from the database and renders them as the
	 * `window.GRAPH_DATA` script the visualisation page loads on boot.
	 */
	private static async buildDataScript(dbPath: string): Promise<string> {
		const store = new KuzuStore(dbPath);
		await store.initSchema();
		try {
			const nodeRows = await store.run(
				'MATCH (n:GraphNode) RETURN n.id AS id, n.kind AS kind, n.name AS name, n.filePath AS filePath, n.exported AS exported, n.startLine AS startLine, n.endLine AS endLine, n.metadata AS metadata',
			);
			const edgeRows = await store.run(
				'MATCH (f:GraphNode)-[e:Edge]->(t:GraphNode) RETURN f.id AS from, e.kind AS kind, t.id AS to, e.metadata AS metadata',
			);
			const nodes = nodeRows.map((row) => ({
				id: String(row.id),
				kind: String(row.kind),
				name: String(row.name),
				filePath: String(row.filePath),
				exported: row.exported === true,
				range: {
					startLine: Number(row.startLine),
					startColumn: 0,
					endLine: Number(row.endLine),
					endColumn: 0,
				},
				metadata: WebCommand.decodeMetadata(row.metadata),
			}));
			const edges = edgeRows.map((row, index) => ({
				id: `e${index}`,
				kind: String(row.kind),
				from: String(row.from),
				to: String(row.to),
				metadata: WebCommand.decodeMetadata(row.metadata),
			}));
			console.log(chalk.cyan(`loaded ${nodes.length} nodes, ${edges.length} edges from ${dbPath}`));
			return `window.GRAPH_DATA = ${JSON.stringify({ nodes, edges })};\n`;
		} finally {
			await store.close();
		}
	}

	/**
	 * Decodes the JSON `metadata` column into a record so the visualisation can
	 * read `metadata.runtime`. A missing, empty (`{}`), or malformed value yields
	 * `undefined`, which `JSON.stringify` omits — keeping the payload small and
	 * letting un-enriched nodes simply carry no metadata.
	 */
	private static decodeMetadata(value: unknown): Record<string, unknown> | undefined {
		if (typeof value !== 'string' || value.length === 0) {
			return undefined;
		}
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed as object).length > 0) {
				return parsed as Record<string, unknown>;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Resolves the GitHub source for the served graph. Prefers the provenance
	 * `extract` recorded in the database — it pins the exact commit and in-repo
	 * `prefix` that was parsed — and falls back to detecting it live from
	 * `sourceDir` for graphs built before provenance was captured. Returns
	 * `undefined` when neither is available, so the page shows plain-text paths.
	 */
	private static async resolveGitHubSource(dbPath: string, sourceDir: string): Promise<SourceManifest | undefined> {
		const stored = await WebCommand.readStoredSource(dbPath);
		if (stored !== undefined) {
			console.log(chalk.cyan(`linking files to ${stored.baseUrl} @ ${stored.commit.slice(0, 7)} (recorded by extract)`));
			return stored;
		}
		const detected = await GitSource.detect(sourceDir);
		if (detected === undefined) {
			console.log(chalk.gray('no GitHub source recorded or detected — file paths will not link to source'));
			return undefined;
		}
		console.log(chalk.cyan(`linking files to ${detected.baseUrl} @ ${detected.commit.slice(0, 7)} (detected from ${sourceDir})`));
		return detected;
	}

	/** Reads the source provenance `load` stored in the database, or `undefined` when absent or malformed. */
	private static async readStoredSource(dbPath: string): Promise<SourceManifest | undefined> {
		const store = new KuzuStore(dbPath);
		await store.initSchema();
		try {
			const raw = await store.readGraphMeta(SOURCE_MANIFEST_KEY);
			if (raw === null) {
				return undefined;
			}
			const parsed = SourceManifestSchema.safeParse(raw);
			return parsed.success === true ? parsed.data : undefined;
		} finally {
			await store.close();
		}
	}

	private static async handle(request: IncomingMessage, response: ServerResponse, dataScript: string): Promise<void> {
		const url = new URL(request.url ?? '/', 'http://localhost');
		const pathname = url.pathname === '/' ? '/index.html' : url.pathname;

		if (pathname === DATA_SCRIPT_PATH) {
			response.writeHead(200, { 'content-type': MIME_TYPES['.js'] });
			response.end(dataScript);
			return;
		}

		const filePath = normalize(join(WEB_ROOT, pathname));
		if (filePath.startsWith(WEB_ROOT + sep) === false) {
			WebCommand.notFound(response);
			return;
		}
		try {
			const content = await readFile(filePath);
			response.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
			response.end(content);
		} catch {
			WebCommand.notFound(response);
		}
	}

	private static notFound(response: ServerResponse): void {
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('not found');
	}
}
