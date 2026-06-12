import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { CheckExecutor, CheckResult, ProjectVerifier } from '../src/verify/project_verifier.js';

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir !== undefined) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

/** A project directory with the given package.json scripts (and nothing else). */
async function makeProject(scripts: Record<string, string> | null): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'verify-'));
	tempDirs.push(dir);
	if (scripts !== null) {
		const packageJson = { name: 'fixture', version: '1.0.0', scripts };
		await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson), 'utf8');
	}
	return dir;
}

/** A fake executor that maps each command string to a fixed exit code + output. */
function fakeExecutor(byCommand: Record<string, { exitCode: number; output: string }>): CheckExecutor {
	return async (command: string) => {
		const result = byCommand[command];
		if (result === undefined) {
			throw new Error(`unexpected command: ${command}`);
		}
		return result;
	};
}

/** A passing/failing/skipped CheckResult, for testing summarize() in isolation. */
function checkResult(name: 'typecheck' | 'test', status: 'pass' | 'fail' | 'skipped'): CheckResult {
	return {
		name,
		command: status === 'skipped' ? null : `npm run ${name}`,
		status,
		exitCode: status === 'skipped' ? null : status === 'pass' ? 0 : 1,
		durationMs: status === 'skipped' ? 0 : 5,
		output: '',
		skippedReason: status === 'skipped' ? 'no "test" script in package.json' : undefined,
	};
}

describe('ProjectVerifier.planChecks', () => {
	it('plans both gates as npm run commands when both scripts exist', () => {
		const plan = ProjectVerifier.planChecks({ typecheck: 'tsc --noEmit', test: 'node --test' });
		assert.deepEqual(plan.map((check) => check.command), ['npm run typecheck', 'npm run test']);
	});

	it('skips the test gate, with a reason, when no test script exists', () => {
		const plan = ProjectVerifier.planChecks({ typecheck: 'tsc --noEmit' });
		const test = plan.find((check) => check.name === 'test');
		assert.equal(test?.command, null);
		assert.match(test?.skippedReason ?? '', /no "test" script/);
	});

	it('honours custom script names', () => {
		const plan = ProjectVerifier.planChecks({ types: 'tsc', spec: 'vitest' }, { typecheckScript: 'types', testScript: 'spec' });
		assert.deepEqual(plan.map((check) => check.command), ['npm run types', 'npm run spec']);
	});

	it('skips a gate on explicit request even when the script exists', () => {
		const plan = ProjectVerifier.planChecks({ typecheck: 'tsc', test: 'node --test' }, { skipTests: true });
		assert.equal(plan.find((check) => check.name === 'test')?.command, null);
		assert.equal(plan.find((check) => check.name === 'typecheck')?.command, 'npm run typecheck');
	});
});

describe('ProjectVerifier.summarize', () => {
	it('is verified when both gates pass', () => {
		const report = ProjectVerifier.summarize([checkResult('typecheck', 'pass'), checkResult('test', 'pass')]);
		assert.equal(report.ok, true);
		assert.equal(report.behaviorVerified, true);
		assert.equal(report.degraded, false);
		assert.match(report.summary, /behaviour checked/);
	});

	it('degrades honestly when tests are skipped: ok but behaviour NOT verified', () => {
		const report = ProjectVerifier.summarize([checkResult('typecheck', 'pass'), checkResult('test', 'skipped')]);
		assert.equal(report.ok, true);
		assert.equal(report.behaviorVerified, false);
		assert.equal(report.degraded, true);
		assert.match(report.summary, /behaviour NOT verified/i);
	});

	it('fails when the type-check fails', () => {
		const report = ProjectVerifier.summarize([checkResult('typecheck', 'fail'), checkResult('test', 'pass')]);
		assert.equal(report.ok, false);
		assert.match(report.summary, /FAILED/);
	});

	it('fails when the tests fail, even though they ran', () => {
		const report = ProjectVerifier.summarize([checkResult('typecheck', 'pass'), checkResult('test', 'fail')]);
		assert.equal(report.ok, false);
		assert.equal(report.behaviorVerified, false);
		assert.match(report.summary, /FAILED/);
	});

	it('cannot verify when every gate is skipped', () => {
		const report = ProjectVerifier.summarize([checkResult('typecheck', 'skipped'), checkResult('test', 'skipped')]);
		assert.equal(report.ok, false);
		assert.match(report.summary, /could not verify/);
	});
});

describe('ProjectVerifier.verify (injected executor)', () => {
	it('keeps an edit when type-check and tests both pass', async () => {
		const dir = await makeProject({ typecheck: 'tsc', test: 'node --test' });
		const exec = fakeExecutor({
			'npm run typecheck': { exitCode: 0, output: 'ok' },
			'npm run test': { exitCode: 0, output: '12 passing' },
		});
		const report = await ProjectVerifier.verify({ cwd: dir }, exec);
		assert.equal(report.ok, true);
		assert.equal(report.behaviorVerified, true);
	});

	it('reverts an edit when the tests fail', async () => {
		const dir = await makeProject({ typecheck: 'tsc', test: 'node --test' });
		const exec = fakeExecutor({
			'npm run typecheck': { exitCode: 0, output: 'ok' },
			'npm run test': { exitCode: 1, output: '1 failing' },
		});
		const report = await ProjectVerifier.verify({ cwd: dir }, exec);
		assert.equal(report.ok, false);
		const test = report.checks.find((check) => check.name === 'test');
		assert.equal(test?.status, 'fail');
	});

	it('falls back to type-check-only for a project with no test script', async () => {
		const dir = await makeProject({ typecheck: 'tsc' });
		const exec = fakeExecutor({ 'npm run typecheck': { exitCode: 0, output: 'ok' } });
		const report = await ProjectVerifier.verify({ cwd: dir }, exec);
		assert.equal(report.ok, true);
		assert.equal(report.behaviorVerified, false);
		assert.equal(report.degraded, true);
	});

	it('cannot verify a directory with no package.json', async () => {
		const dir = await makeProject(null);
		const exec = fakeExecutor({});
		const report = await ProjectVerifier.verify({ cwd: dir }, exec);
		assert.equal(report.ok, false);
		assert.match(report.summary, /could not verify/);
	});
});

describe('ProjectVerifier.verify (real subprocess)', () => {
	it('runs the project npm scripts, maps exit codes to pass/fail, and captures output', async () => {
		const dir = await makeProject({ typecheck: 'exit 0', test: 'echo VERIFY_MARKER_XYZ; exit 3' });
		const report = await ProjectVerifier.verify({ cwd: dir });
		const typecheck = report.checks.find((check) => check.name === 'typecheck');
		const test = report.checks.find((check) => check.name === 'test');
		assert.equal(typecheck?.status, 'pass');
		assert.equal(test?.status, 'fail');
		assert.notEqual(test?.exitCode, 0);
		assert.match(test?.output ?? '', /VERIFY_MARKER_XYZ/);
		assert.equal(report.ok, false);
	});
});
