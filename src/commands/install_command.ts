import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { PROJECT_ROOT } from '../project_root.js';

const SKILL_SOURCE_PATH = 'dotclaude_folder/skills/code-graph-query/SKILL.md';
const SKILL_TARGET_PATH = 'skills/code-graph-query/SKILL.md';

type InstallOptions = {
	force: boolean;
};

/**
 * Installs the bundled Claude Code skill into a target project so an agent can
 * query the knowledge graph through the ts-knowledge-graph CLI.
 */
export class InstallCommand {
	static register(program: Command): void {
		program
			.command('install')
			.description('install the ts-knowledge-graph Claude Code skill into a project')
			.argument('[destFolder]', 'project root to install the skill into', process.cwd())
			.option('--force', 'overwrite an existing SKILL.md', false)
			.action(async (destFolder: string, options: InstallOptions) => {
				await InstallCommand.run(destFolder, options);
			});
	}

	private static async run(destFolder: string, options: InstallOptions): Promise<void> {
		const source = InstallCommand.sourceSkillPath();
		const target = resolve(destFolder, SKILL_TARGET_PATH);

		if (existsSync(target) === true && options.force === false) {
			console.log(chalk.yellow(`✗ ${target} already exists — pass --force to overwrite`));
			return;
		}

		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
		console.log(chalk.green(`✓ installed skill -> ${target}`));
	}

	/**
	 * Resolves the bundled SKILL.md from the package root, which works whether
	 * running via tsx from `src` or from the built `dist` output.
	 */
	private static sourceSkillPath(): string {
		return resolve(PROJECT_ROOT, SKILL_SOURCE_PATH);
	}
}
