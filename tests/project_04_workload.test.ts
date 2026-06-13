import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, DEFAULT_SCENARIO } from '../scripts/benchmarks/project_04_workload.js';

test('the load generator is deterministic: a fixed seed yields identical reports', () => {
	const first = runScenario(DEFAULT_SCENARIO);
	const second = runScenario(DEFAULT_SCENARIO);
	assert.deepEqual(first, second);
});

test('the default scenario ramps past its knee and is CPU-bottlenecked', () => {
	const report = runScenario(DEFAULT_SCENARIO);
	assert.notEqual(report.knee, null);
	assert.equal(report.knee?.dimension, 'cpu');
	assert.equal(report.peak.bottleneck, 'cpu');
	assert.ok(report.failedRequests > 0, 'overload steps should produce failures');
	assert.ok(report.completedRequests > 0, 'pre-knee steps should complete');
});
