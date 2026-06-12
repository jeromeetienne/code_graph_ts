/**
 * Pure statistics for the benchmark gate. Runtime measurement is noisy, so a
 * single number lies: every benchmark reports the **median** of N runs plus the
 * **spread**, and a baseline→after comparison is an advisory delta, never a
 * deterministic guarantee. These helpers are deliberately side-effect-free so
 * the variance handling is unit-tested directly, apart from any profiling.
 */

/** A node's metric distribution over N runs: the headline median plus the spread that qualifies it. */
export type BenchmarkStatsSummary = {
	runs: number;
	median: number;
	min: number;
	max: number;
	mean: number;
	/** `max - min`: the observed spread, a coarse read on how noisy the measurement was. */
	spread: number;
	/** The raw per-run samples, in run order. */
	values: number[];
};

/** A baseline→after comparison of two medians. Negative `absolute`/`percent` means the metric went down (faster / fewer). */
export type BenchmarkDelta = {
	baselineMedian: number;
	currentMedian: number;
	/** `currentMedian - baselineMedian`. */
	absolute: number;
	/** `absolute / baselineMedian`, e.g. `-0.38` for a 38% reduction. `NaN` when the baseline median is 0. */
	percent: number;
};

export class BenchmarkStats {
	/** The median of a non-empty sample set (mean of the two middle values when the count is even). */
	static median(values: number[]): number {
		if (values.length === 0) {
			throw new Error('median of an empty sample set');
		}
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		if (sorted.length % 2 === 1) {
			return sorted[mid];
		}
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}

	/** Reduce per-run samples to the median + spread summary. Throws on an empty set. */
	static summarize(values: number[]): BenchmarkStatsSummary {
		if (values.length === 0) {
			throw new Error('cannot summarize a benchmark with no runs');
		}
		const min = Math.min(...values);
		const max = Math.max(...values);
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		return {
			runs: values.length,
			median: BenchmarkStats.median(values),
			min,
			max,
			mean,
			spread: max - min,
			values: [...values],
		};
	}

	/** Compare a prior baseline median against the current median. `percent` is `NaN` when the baseline is 0. */
	static delta(baselineMedian: number, currentMedian: number): BenchmarkDelta {
		const absolute = currentMedian - baselineMedian;
		const percent = baselineMedian === 0 ? Number.NaN : absolute / baselineMedian;
		return { baselineMedian, currentMedian, absolute, percent };
	}

	/** Format a fractional change as a signed percentage, e.g. `-0.38` → `"-38.0%"`; `NaN` → `"n/a"`. */
	static formatPercent(percent: number): string {
		if (Number.isNaN(percent) === true) {
			return 'n/a';
		}
		const sign = percent > 0 ? '+' : '';
		return `${sign}${(percent * 100).toFixed(1)}%`;
	}

	/** A one-word read on a delta for a lower-is-better metric (time / samples), within a noise tolerance. */
	static direction(delta: BenchmarkDelta, spread: number): 'improved' | 'regressed' | 'unchanged' {
		if (Math.abs(delta.absolute) <= spread) {
			return 'unchanged';
		}
		return delta.absolute < 0 ? 'improved' : 'regressed';
	}
}
