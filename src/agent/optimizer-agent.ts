import OpenAI from 'openai';
import { AGENT_TOOLS, AgentTools, PROPOSE_TOOL_NAME } from './agent-tools.js';
import { CodeEditor } from './code-editor.js';
import { Verifier } from './verifier.js';

const SYSTEM_PROMPT = `You are an autonomous TypeScript optimization agent working on a real codebase.

You have a code knowledge graph at your disposal through tools. Use it as your eyes.

Method (follow it):
1. Find a candidate. Dead code is the safest win — call dead_exports first, or find_symbol for a named target.
2. Understand the blast radius. Before proposing ANY change you MUST confirm safety with references / who_calls / blast_radius. A symbol is safe to remove only when it has zero inbound references.
3. Read the exact text with read_file so your edit matches the file precisely.
4. Propose exactly ONE edit via ${PROPOSE_TOOL_NAME}. The harness type-checks it and keeps it only if the check passes; on failure you receive the compiler errors and must fix or abandon.

Rules:
- ids come from tool results; never invent them.
- Act autonomously — do not ask the user questions. Make the call yourself.
- Prefer removing genuinely dead exports or behavior-preserving simplifications. Never change observable behavior.
- When you have applied a verified improvement (or concluded there is no safe one), stop and summarize.`;

export type AppliedEdit = {
	filePath: string;
	rationale: string;
};

export type OptimizeOutcome = {
	applied: AppliedEdit[];
	transcript: string[];
};

export type OptimizerParams = {
	tools: AgentTools;
	editor: CodeEditor;
	rootPath: string;
	model: string;
	maxSteps?: number;
};

export class OptimizerAgent {
	private readonly client: OpenAI;
	private readonly tools: AgentTools;
	private readonly editor: CodeEditor;
	private readonly rootPath: string;
	private readonly model: string;
	private readonly maxSteps: number;

	constructor(params: OptimizerParams) {
		this.client = new OpenAI();
		this.tools = params.tools;
		this.editor = params.editor;
		this.rootPath = params.rootPath;
		this.model = params.model;
		this.maxSteps = params.maxSteps ?? 12;
	}

	async run(task: string): Promise<OptimizeOutcome> {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: task },
		];
		const applied: AppliedEdit[] = [];
		const transcript: string[] = [];

		for (let step = 0; step < this.maxSteps; step += 1) {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages,
				tools: AGENT_TOOLS,
			});
			const message = completion.choices[0].message;
			messages.push(message);

			if (typeof message.content === 'string' && message.content.length > 0) {
				transcript.push(message.content);
			}

			const toolCalls = message.tool_calls ?? [];
			if (toolCalls.length === 0) {
				break;
			}

			for (const call of toolCalls) {
				if (call.type !== 'function') {
					messages.push({ role: 'tool', tool_call_id: call.id, content: 'unsupported tool call type' });
					continue;
				}
				const input = OptimizerAgent.parseArguments(call.function.arguments);
				const content = call.function.name === PROPOSE_TOOL_NAME
					? await this.applyAndVerify(input, applied, transcript)
					: await this.tools.dispatch(call.function.name, input);
				messages.push({ role: 'tool', tool_call_id: call.id, content });
			}
		}

		return { applied, transcript };
	}

	private async applyAndVerify(
		input: Record<string, unknown>,
		applied: AppliedEdit[],
		transcript: string[],
	): Promise<string> {
		const request = {
			filePath: String(input.filePath),
			find: String(input.find),
			replace: String(input.replace),
		};
		const rationale = String(input.rationale ?? '');

		const edit = await this.editor.apply(request);
		if (edit.ok === false) {
			return `EDIT REJECTED: ${edit.message}`;
		}

		const verify = await Verifier.typecheck(this.rootPath);
		if (verify.ok === false) {
			await this.editor.revert(request.filePath);
			return `TYPECHECK FAILED — change reverted. Fix the approach or abandon it. Compiler output:\n${verify.output}`;
		}

		applied.push({ filePath: request.filePath, rationale });
		transcript.push(`APPLIED ${request.filePath} — ${rationale}`);
		return 'VERIFIED: the type-checker passed and the edit was kept.';
	}

	private static parseArguments(raw: string): Record<string, unknown> {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed === 'object' && parsed !== null) {
				return parsed as Record<string, unknown>;
			}
			return {};
		} catch {
			return {};
		}
	}
}
