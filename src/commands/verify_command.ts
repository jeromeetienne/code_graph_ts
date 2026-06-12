import chalk from 'chalk';
import { Command } from 'commander';
import { CheckResult, ProjectVerifier, VerifyReport } from '../verify/project_verifier.js';

type VerifyCommandOptions = {
	cwd: string;
	typecheckScript: string;
	testScript: string;
	skipTypecheck?: boolean;
	skipTests?: boolean;
	json?: boolean;
};

export class VerifyCommand {
	static register(program: Command): void {
		program
			.command('verify')
			.description('run the project type-check + test gates and return one keep/revert verdict for an edit')
			.option('-C, --cwd <path>', 'project directory whose package.json scripts are run', process.cwd())
			.option('--typecheck-script <name>', 'npm script for the type-check gate', 'typecheck')
			.option('--test-script <name>', 'npm script for the test gate', 'test')
			.option('--skip-typecheck', 'skip the type-check gate', false)
			.option('--skip-tests', 'skip the test gate (degrades to type-check-only)', false)
			.option('--json', 'emit the verdict as JSON', false)
			.action(async (options: VerifyCommandOptions) => {
				const report = await ProjectVerifier.verify({
					cwd: options.cwd,
					typecheckScript: options.typecheckScript,
					testScript: options.testScript,
					skipTypecheck: options.skipTypecheck === true,
					skipTests: options.skipTests === true,
				});
				VerifyCommand.print(report, options.json === true);
				process.exitCode = report.ok === true ? 0 : 1;
			});
	}

	private static print(report: VerifyReport, json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		for (const check of report.checks) {
			VerifyCommand.printCheck(check);
		}
		const verdict = report.ok === true ? chalk.green('✓') : chalk.red('✗');
		console.log(`\n${verdict} ${report.summary}`);
		VerifyCommand.printFailureOutput(report);
	}

	private static printCheck(check: CheckResult): void {
		if (check.status === 'skipped') {
			console.log(`${chalk.yellow('•')} ${chalk.bold(check.name.padEnd(10))} ${chalk.yellow('skipped')}  ${chalk.gray(check.skippedReason ?? '')}`);
			return;
		}
		const mark = check.status === 'pass' ? chalk.green('✓') : chalk.red('✗');
		const timing = chalk.gray(`${(check.durationMs / 1000).toFixed(1)}s`);
		console.log(`${mark} ${chalk.bold(check.name.padEnd(10))} ${chalk.gray(check.command ?? '')}  ${timing}`);
	}

	private static printFailureOutput(report: VerifyReport): void {
		if (report.ok === true) {
			return;
		}
		for (const check of report.checks.filter((candidate) => candidate.status === 'fail')) {
			console.log(chalk.bold(`\n— ${check.name} output (tail) —`));
			console.log(check.output.trimEnd());
		}
	}
}
