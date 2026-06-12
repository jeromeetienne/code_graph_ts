import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BenchmarkStats } from '../src/benchmark/benchmark_stats.js';

describe('BenchmarkStats.median', () => {
	it('returns the middle value for an odd count', () => {
		assert.equal(BenchmarkStats.median([9, 13, 11, 10, 12]), 11);
	});

	it('averages the two middle values for an even count', () => {
		assert.equal(BenchmarkStats.median([10, 20, 30, 40]), 25);
	});

	it('does not mutate the input order', () => {
		const values = [3, 1, 2];
		BenchmarkStats.median(values);
		assert.deepEqual(values, [3, 1, 2]);
	});

	it('throws on an empty set', () => {
		assert.throws(() => BenchmarkStats.median([]), /empty/);
	});
});

describe('BenchmarkStats.summarize', () => {
	it('reports median, min, max, mean, spread and run count', () => {
		const summary = BenchmarkStats.summarize([9, 13, 11, 10, 12]);
		assert.equal(summary.runs, 5);
		assert.equal(summary.median, 11);
		assert.equal(summary.min, 9);
		assert.equal(summary.max, 13);
		assert.equal(summary.mean, 11);
		assert.equal(summary.spread, 4);
	});

	it('throws when there are no runs to summarize', () => {
		assert.throws(() => BenchmarkStats.summarize([]), /no runs/);
	});
});

describe('BenchmarkStats.delta', () => {
	it('computes a negative percent for an improvement (lower is better)', () => {
		const delta = BenchmarkStats.delta(20, 12.4);
		assert.equal(delta.baselineMedian, 20);
		assert.equal(delta.currentMedian, 12.4);
		assert.equal(Math.round(delta.absolute * 10) / 10, -7.6);
		assert.equal(Math.round(delta.percent * 1000) / 1000, -0.38);
	});

	it('computes a positive percent for a regression', () => {
		const delta = BenchmarkStats.delta(10, 15);
		assert.equal(delta.absolute, 5);
		assert.equal(delta.percent, 0.5);
	});

	it('yields NaN percent when the baseline median is zero', () => {
		const delta = BenchmarkStats.delta(0, 4);
		assert.equal(Number.isNaN(delta.percent), true);
	});
});

describe('BenchmarkStats.formatPercent', () => {
	it('signs an improvement and a regression', () => {
		assert.equal(BenchmarkStats.formatPercent(-0.38), '-38.0%');
		assert.equal(BenchmarkStats.formatPercent(0.5), '+50.0%');
	});

	it('renders NaN as n/a', () => {
		assert.equal(BenchmarkStats.formatPercent(Number.NaN), 'n/a');
	});
});

describe('BenchmarkStats.direction', () => {
	it('calls a change within the spread unchanged (noise)', () => {
		const delta = BenchmarkStats.delta(10, 9.5);
		assert.equal(BenchmarkStats.direction(delta, 1), 'unchanged');
	});

	it('calls a drop larger than the spread an improvement', () => {
		const delta = BenchmarkStats.delta(20, 12);
		assert.equal(BenchmarkStats.direction(delta, 1), 'improved');
	});

	it('calls a rise larger than the spread a regression', () => {
		const delta = BenchmarkStats.delta(10, 20);
		assert.equal(BenchmarkStats.direction(delta, 1), 'regressed');
	});
});
