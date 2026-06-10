import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { Command } from 'commander';
import { AgentTools } from '../agent/agent_tools.js';
import { CodeEditor } from '../agent/code_editor.js';
import { OptimizerAgent } from '../agent/optimizer_agent.js';
import { CommandHelpers, DEFAULT_DB_PATH } from './command_helpers.js';

const DEFAULT_TASK = 'Find one genuinely dead exported symbol using dead_exports, confirm with references that it has zero inbound references, then remove it safely.';

type OptimizeOptions = {
	db: string;
	model?: string;
	maxSteps: string;
};

export class Optimize {
	static register(program: Command): void {
		program
			.command('optimize')
			.description('run the autonomous optimization agent against the loaded graph')
			.argument('[task]', 'what the agent should try to optimize', DEFAULT_TASK)
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('-m, --model <name>', 'model name (defaults to OPENAI_MODEL)')
			.option('--max-steps <n>', 'maximum agent steps', '12')
			.action(async (task: string, options: OptimizeOptions) => {
				await Optimize.run(task, options);
			});
	}

	private static async run(task: string, options: OptimizeOptions): Promise<void> {
		if (existsSync('.env') === true) {
			process.loadEnvFile('.env');
		}
		if (process.env.OPENAI_API_KEY === undefined) {
			console.log(chalk.red('Set OPENAI_API_KEY before running the optimizer — copy .env-sample to .env and pick a provider.'));
			return;
		}
		const model = options.model ?? process.env.OPENAI_MODEL;
		if (model === undefined) {
			console.log(chalk.red('Set OPENAI_MODEL in .env (or pass --model) — see .env-sample for per-provider examples.'));
			return;
		}
		const rootPath = process.cwd();
		await CommandHelpers.withQuery(options.db, async (query) => {
			const agent = new OptimizerAgent({
				tools: new AgentTools(query, rootPath),
				editor: new CodeEditor(rootPath),
				rootPath,
				model,
				maxSteps: Number(options.maxSteps),
			});
			console.log(chalk.gray(`Model: ${model}${process.env.OPENAI_BASE_URL === undefined ? '' : ` @ ${process.env.OPENAI_BASE_URL}`}`));
			console.log(chalk.cyan(`Task: ${task}\n`));
			const outcome = await agent.run(task);

			for (const line of outcome.transcript) {
				console.log(chalk.gray(line));
			}
			console.log(chalk.bold(`\nApplied ${outcome.applied.length} verified edit(s):`));
			for (const edit of outcome.applied) {
				console.log(`  ${chalk.green('✓')} ${edit.filePath} — ${edit.rationale}`);
			}
			if (outcome.applied.length === 0) {
				console.log(chalk.yellow('  (none — the agent found no safe change, or reverted what it tried)'));
			}
		});
	}
}
