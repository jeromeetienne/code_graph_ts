import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * The reusable verify path for the optimization loop: run the project's
 * type-check and test gates and reduce them to one pass/fail verdict, plus the
 * honesty flags an agent needs (was *behaviour* verified, or only types?).
 *
 * A type-check proves the edit compiles; it cannot see a swapped operator, an
 * off-by-one, or a dropped branch. Running the test suite alongside `tsc` is
 * what turns "still compiles" into "still works". When a project has no test
 * script the test gate degrades to skipped and {@link VerifyReport.behaviorVerified}
 * stays false, so the caller can report the change as unverified rather than
 * implying it was behaviourally checked.
 */

/** The two correctness gates, run in order. */
export type CheckName = 'typecheck' | 'test';

/** A gate ran and passed, ran and failed, or never ran. */
export type CheckStatus = 'pass' | 'fail' | 'skipped';

/** A gate resolved from the project's package.json: its command, or why it was skipped. */
export type PlannedCheck = {
	name: CheckName;
	/** The shell command to run, or `null` when the gate is skipped. */
	command: string | null;
	/** Why the gate will not run (e.g. no matching npm script), set when `command` is null. */
	skippedReason?: string;
};

/** The outcome of executing (or skipping) one gate. */
export type CheckResult = {
	name: CheckName;
	command: string | null;
	status: CheckStatus;
	/** Process exit code; `null` when the gate was skipped or the process died on a signal. */
	exitCode: number | null;
	durationMs: number;
	/** Combined stdout+stderr, tail-bounded to the last `outputTailLines` lines. */
	output: string;
	skippedReason?: string;
};

/** The single verdict the optimize loop consumes to keep or revert an edit. */
export type VerifyReport = {
	/** True when at least one gate ran and no gate that ran failed. */
	ok: boolean;
	/** True only when the test gate actually ran and passed — behaviour, not just types, was checked. */
	behaviorVerified: boolean;
	/** True when a gate was skipped (e.g. the project has no test script), so `ok` is weaker than a full pass. */
	degraded: boolean;
	checks: CheckResult[];
	/** A one-line, quotable verdict that states exactly what was and was not verified. */
	summary: string;
};

export type VerifyOptions = {
	/** Project root whose package.json is read and whose scripts are run. Defaults to `process.cwd()`. */
	cwd?: string;
	/** npm script name for the type-check gate. Default `typecheck`. */
	typecheckScript?: string;
	/** npm script name for the test gate. Default `test`. */
	testScript?: string;
	/** Skip the type-check gate entirely. */
	skipTypecheck?: boolean;
	/** Skip the test gate entirely (degrades to type-check-only, reported honestly). */
	skipTests?: boolean;
	/** Keep only the last N lines of each gate's captured output. Default 80. */
	outputTailLines?: number;
};

/** How a planned gate is executed. Injectable so tests need not spawn npm. */
export type CheckExecutor = (command: string, cwd: string) => Promise<{ exitCode: number | null; output: string }>;

const DEFAULT_TYPECHECK_SCRIPT = 'typecheck';
const DEFAULT_TEST_SCRIPT = 'test';
const DEFAULT_TAIL_LINES = 80;

const PackageJsonSchema = z.object({ scripts: z.record(z.unknown()).optional() });

export class ProjectVerifier {
	/**
	 * Run the project's verify gates and return one verdict. `exec` defaults to a
	 * real subprocess spawn; tests inject a fake to avoid running npm.
	 */
	static async verify(options: VerifyOptions = {}, exec: CheckExecutor = ProjectVerifier.spawnCommand): Promise<VerifyReport> {
		const cwd = resolve(options.cwd ?? process.cwd());
		const tailLines = options.outputTailLines ?? DEFAULT_TAIL_LINES;
		const scripts = await ProjectVerifier.readScripts(cwd);
		const plan = ProjectVerifier.planChecks(scripts, options);
		const results: CheckResult[] = [];
		for (const check of plan) {
			results.push(await ProjectVerifier.runCheck(check, cwd, tailLines, exec));
		}
		return ProjectVerifier.summarize(results);
	}

	/** Resolve each gate against the project's scripts, deciding what will run and what is skipped (pure). */
	static planChecks(scripts: Record<string, string>, options: VerifyOptions = {}): PlannedCheck[] {
		const typecheckScript = options.typecheckScript ?? DEFAULT_TYPECHECK_SCRIPT;
		const testScript = options.testScript ?? DEFAULT_TEST_SCRIPT;
		return [
			ProjectVerifier.planOne('typecheck', typecheckScript, scripts, options.skipTypecheck === true),
			ProjectVerifier.planOne('test', testScript, scripts, options.skipTests === true),
		];
	}

	/** Reduce a set of gate results to the single verdict, including the honesty flags (pure). */
	static summarize(checks: CheckResult[]): VerifyReport {
		const ran = checks.filter((check) => check.status !== 'skipped');
		const failed = ran.filter((check) => check.status === 'fail');
		const test = checks.find((check) => check.name === 'test');
		const behaviorVerified = test !== undefined && test.status === 'pass';
		const ok = ran.length > 0 && failed.length === 0;
		const degraded = checks.some((check) => check.status === 'skipped');
		const summary = ProjectVerifier.buildSummary(ran, failed, test, ok, behaviorVerified);
		return { ok, behaviorVerified, degraded, checks, summary };
	}

	private static planOne(name: CheckName, script: string, scripts: Record<string, string>, skip: boolean): PlannedCheck {
		if (skip === true) {
			return { name, command: null, skippedReason: 'skipped by request' };
		}
		if (typeof scripts[script] !== 'string') {
			return { name, command: null, skippedReason: `no "${script}" script in package.json` };
		}
		return { name, command: `npm run ${script}` };
	}

	private static async runCheck(check: PlannedCheck, cwd: string, tailLines: number, exec: CheckExecutor): Promise<CheckResult> {
		if (check.command === null) {
			return {
				name: check.name,
				command: null,
				status: 'skipped',
				exitCode: null,
				durationMs: 0,
				output: '',
				skippedReason: check.skippedReason,
			};
		}
		const startedAt = Date.now();
		const { exitCode, output } = await exec(check.command, cwd);
		return {
			name: check.name,
			command: check.command,
			status: exitCode === 0 ? 'pass' : 'fail',
			exitCode,
			durationMs: Date.now() - startedAt,
			output: ProjectVerifier.tail(output, tailLines),
		};
	}

	private static buildSummary(
		ran: CheckResult[],
		failed: CheckResult[],
		test: CheckResult | undefined,
		ok: boolean,
		behaviorVerified: boolean,
	): string {
		if (ran.length === 0) {
			return 'could not verify: no type-check or test script found — change is unverified';
		}
		if (ok === false) {
			return `FAILED: ${failed.map((check) => check.name).join(' and ')} did not pass — revert the edit`;
		}
		if (behaviorVerified === true) {
			return `verified: ${ran.map((check) => check.name).join(' + ')} passed (behaviour checked)`;
		}
		const why = test?.skippedReason ?? 'tests did not run';
		return `type-check passed, but ${why} — behaviour NOT verified`;
	}

	private static async readScripts(cwd: string): Promise<Record<string, string>> {
		try {
			const raw = await readFile(resolve(cwd, 'package.json'), 'utf8');
			const parsed = PackageJsonSchema.safeParse(JSON.parse(raw));
			if (parsed.success === false) {
				return {};
			}
			const scripts: Record<string, string> = {};
			for (const [name, value] of Object.entries(parsed.data.scripts ?? {})) {
				if (typeof value === 'string') {
					scripts[name] = value;
				}
			}
			return scripts;
		} catch {
			return {};
		}
	}

	private static tail(text: string, lines: number): string {
		if (lines <= 0) {
			return text;
		}
		const allLines = text.split('\n');
		if (allLines.length <= lines) {
			return text;
		}
		return allLines.slice(allLines.length - lines).join('\n');
	}

	private static spawnCommand(command: string, cwd: string): Promise<{ exitCode: number | null; output: string }> {
		return new Promise((resolvePromise) => {
			const child = spawn(command, { cwd, shell: true });
			let output = '';
			const append = (chunk: Buffer): void => {
				output += chunk.toString();
			};
			child.stdout.on('data', append);
			child.stderr.on('data', append);
			child.on('error', (error) => {
				output += `\n${error.message}`;
				resolvePromise({ exitCode: 1, output });
			});
			child.on('close', (code) => {
				resolvePromise({ exitCode: code, output });
			});
		});
	}
}
