import type { Grouped } from '../shared/types.js';

/** Pure, side-effect-free array helpers. */
export class ArrayUtils {
	/** Split into consecutive chunks of at most `size` elements. */
	static chunk<T>(items: readonly T[], size: number): T[][] {
		if (size <= 0) {
			throw new Error('size must be greater than zero');
		}
		const result: T[][] = [];
		for (let index = 0; index < items.length; index += size) {
			result.push(items.slice(index, index + size));
		}
		return result;
	}

	/** Remove duplicate values, preserving first-seen order. */
	static unique<T>(items: readonly T[]): T[] {
		return [...new Set(items)];
	}

	/** Flatten one level of nesting. */
	static flatten<T>(items: readonly T[][]): T[] {
		const result: T[] = [];
		for (const group of items) {
			result.push(...group);
		}
		return result;
	}

	/** Group items into buckets keyed by a value derived from each element. */
	static groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Grouped<T> {
		const result: Grouped<T> = {};
		for (const item of items) {
			const key = keyOf(item);
			const bucket = result[key] ?? [];
			bucket.push(item);
			result[key] = bucket;
		}
		return result;
	}
}
