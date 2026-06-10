import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { GraphQuery } from '../query/graph-query.js';

export const PROPOSE_TOOL_NAME = 'propose_optimization';

export const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'find_symbol',
			description: 'Resolve a symbol name (substring, case-insensitive) to candidate node ids. Always start here to obtain ids; never invent ids.',
			parameters: {
				type: 'object',
				properties: { name: { type: 'string', description: 'symbol name or substring' } },
				required: ['name'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'who_calls',
			description: 'List the direct callers of a function/method node id.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'node id from find_symbol' } },
				required: ['id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'references',
			description: 'List everything that references a symbol or type (calls, type usage, heritage, instantiation, value reads). Use this to judge whether a symbol is safe to remove.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'node id from find_symbol' } },
				required: ['id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'blast_radius',
			description: 'List every symbol transitively impacted by changing a node id (transitive callers).',
			parameters: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'node id from find_symbol' },
					depth: { type: 'integer', description: 'max traversal depth (default 10)' },
				},
				required: ['id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'neighbors',
			description: 'Show the one-hop neighbourhood (incoming and outgoing edges) of a node id.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'node id from find_symbol' } },
				required: ['id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'dead_exports',
			description: 'List exported symbols that have no inbound references anywhere in the project — prime candidates for safe removal.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read a project source file (optionally a line range) to see exact text before proposing an edit.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'project-relative file path, e.g. src/schema/node.ts' },
					startLine: { type: 'integer', description: 'first line (1-based, optional)' },
					endLine: { type: 'integer', description: 'last line (inclusive, optional)' },
				},
				required: ['path'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: PROPOSE_TOOL_NAME,
			description: 'Propose ONE safe edit. The harness applies it, runs the TypeScript type-checker, and keeps it only if type-checking passes (otherwise it is reverted and you get the errors). `find` must match the file exactly and uniquely.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'project-relative file path' },
					find: { type: 'string', description: 'exact text to replace (must be unique in the file)' },
					replace: { type: 'string', description: 'replacement text (empty string to delete)' },
					rationale: { type: 'string', description: 'why this change is safe and beneficial' },
				},
				required: ['filePath', 'find', 'replace', 'rationale'],
			},
		},
	},
];

export class AgentTools {
	private readonly query: GraphQuery;
	private readonly rootPath: string;

	constructor(query: GraphQuery, rootPath: string) {
		this.query = query;
		this.rootPath = rootPath;
	}

	async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
		switch (name) {
			case 'find_symbol':
				return AgentTools.stringify(await this.query.find(String(input.name)));
			case 'who_calls':
				return AgentTools.stringify(await this.query.whoCalls(String(input.id)));
			case 'references':
				return AgentTools.stringify(await this.query.references(String(input.id)));
			case 'blast_radius':
				return AgentTools.stringify(await this.query.blastRadius(String(input.id), Number(input.depth ?? 10)));
			case 'neighbors':
				return AgentTools.stringify(await this.query.neighborhood(String(input.id)));
			case 'dead_exports':
				return AgentTools.stringify(await this.query.deadExports());
			case 'read_file':
				return this.readFile(input);
			default:
				return `unknown tool: ${name}`;
		}
	}

	private async readFile(input: Record<string, unknown>): Promise<string> {
		const absolute = resolve(this.rootPath, String(input.path));
		const content = await readFile(absolute, 'utf8').catch(() => undefined);
		if (content === undefined) {
			return `file not found: ${String(input.path)}`;
		}
		const lines = content.split('\n');
		const start = input.startLine === undefined ? 1 : Number(input.startLine);
		const end = input.endLine === undefined ? lines.length : Number(input.endLine);
		return lines
			.slice(start - 1, end)
			.map((line, index) => `${start + index}\t${line}`)
			.join('\n');
	}

	private static stringify(value: unknown): string {
		return JSON.stringify(value, null, 2);
	}
}
