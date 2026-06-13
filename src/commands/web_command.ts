import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { Command } from 'commander';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH } from './command_helpers.js';

const execFileAsync = promisify(execFile);

/**
 * Static assets of the web visualisation, resolved relative to this module so
 * the same path works from `src/` (tsx) and from `dist/` (published package).
 */
const WEB_ROOT = fileURLToPath(new URL('../../contribs/web_visualisation/web', import.meta.url));

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
 * GitHub source descriptor injected into the page as `window.GRAPH_SOURCE.github`
 * so the visualisation can turn each file path into a permalink at the exact
 * analysed commit.
 */
type GitHubSource = {
	/** Repository web base, e.g. `https://github.com/owner/repo`. */
	baseUrl: string;
	/** Resolved HEAD commit SHA the graph was extracted at. */
	commit: string;
	/** Path of the analysed root within the repository — `''` at the repo root, otherwise `sub/dir/`. */
	prefix: string;
};

/**
 * `web` command — serves the knowledge graph database in an interactive web
 * visualisation. The graph is read from Kùzu once at startup and injected into
 * the page as `/data/graph_data.js`; all other assets are served statically
 * from the contribs/web_visualisation/web directory.
 */
export class WebCommand {
	static register(program: Command): void {
		program
			.command('web')
			.description('serve the knowledge graph database in a web visualisation')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('-p, --port <port>', 'HTTP port to listen on', DEFAULT_PORT)
			.option('-s, --source <dir>', 'project root the graph was extracted from, used to link files to GitHub', '.')
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

		const sourceScript = await WebCommand.buildSourceScript(resolve(options.source));
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
	 * Renders the `window.GRAPH_SOURCE` script that lets the visualisation link
	 * file paths to GitHub. Returns an empty string when `sourceDir` is not a
	 * GitHub work tree, so the page falls back to plain-text file paths.
	 */
	private static async buildSourceScript(sourceDir: string): Promise<string> {
		const github = await WebCommand.detectGitHubSource(sourceDir);
		if (github === undefined) {
			console.log(chalk.gray('no GitHub remote detected — file paths will not link to source'));
			return '';
		}
		console.log(chalk.cyan(`linking files to ${github.baseUrl} @ ${github.commit.slice(0, 7)}`));
		return `window.GRAPH_SOURCE = ${JSON.stringify({ github })};\n`;
	}

	/**
	 * Detects the GitHub repository, HEAD commit, and in-repo path prefix for the
	 * directory the graph was extracted from. Returns `undefined` when `sourceDir`
	 * is not a Git work tree, has no GitHub `origin` remote, or Git is unavailable.
	 */
	private static async detectGitHubSource(sourceDir: string): Promise<GitHubSource | undefined> {
		const git = async (...args: string[]): Promise<string | undefined> => {
			try {
				const { stdout } = await execFileAsync('git', ['-C', sourceDir, ...args]);
				return stdout.trim();
			} catch {
				return undefined;
			}
		};

		if (await git('rev-parse', '--is-inside-work-tree') !== 'true') {
			return undefined;
		}
		const remoteUrl = await git('remote', 'get-url', 'origin');
		const commit = await git('rev-parse', 'HEAD');
		const baseUrl = remoteUrl === undefined ? undefined : WebCommand.githubBaseUrl(remoteUrl);
		if (baseUrl === undefined || commit === undefined) {
			return undefined;
		}
		return { baseUrl, commit, prefix: await git('rev-parse', '--show-prefix') ?? '' };
	}

	/**
	 * Normalises a Git `origin` URL to its GitHub web base
	 * (`https://<host>/<owner>/<repo>`), or `undefined` for non-GitHub remotes.
	 * Handles the SCP-like (`git@host:owner/repo.git`), `https://`, `git://`, and
	 * `ssh://` forms, with or without a trailing `.git`. The host is kept as-is so
	 * GitHub Enterprise remotes resolve to their own domain.
	 */
	static githubBaseUrl(remoteUrl: string): string | undefined {
		const trimmed = remoteUrl.trim();
		let host: string;
		let path: string;
		if (trimmed.includes('://') === true) {
			try {
				const parsed = new URL(trimmed);
				host = parsed.host;
				path = parsed.pathname;
			} catch {
				return undefined;
			}
		} else {
			const scpMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
			if (scpMatch === null) {
				return undefined;
			}
			host = scpMatch[1];
			path = scpMatch[2];
		}
		if (host.toLowerCase().includes('github') === false) {
			return undefined;
		}
		const segments = path.replace(/\.git$/, '').split('/').filter((segment) => segment.length > 0);
		if (segments.length < 2) {
			return undefined;
		}
		return `https://${host}/${segments[0]}/${segments[1]}`;
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
