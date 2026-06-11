import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayUtils } from '../src/utils/array_utils.js';
import type { Grouped } from '../src/shared/types.js';

test('chunk splits into fixed-size groups', () => {
	assert.deepEqual(ArrayUtils.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('chunk rejects a non-positive size', () => {
	assert.throws(() => ArrayUtils.chunk([1, 2, 3], 0), /greater than zero/);
});

test('unique preserves first-seen order', () => {
	assert.deepEqual(ArrayUtils.unique([3, 1, 3, 2, 1]), [3, 1, 2]);
});

test('flatten removes one level of nesting', () => {
	assert.deepEqual(ArrayUtils.flatten([[1, 2], [3], []]), [1, 2, 3]);
});

test('groupBy buckets items by a derived key', () => {
	const grouped: Grouped<string> = ArrayUtils.groupBy(
		['apple', 'avocado', 'banana'],
		(fruit) => fruit[0],
	);
	assert.deepEqual(grouped, { a: ['apple', 'avocado'], b: ['banana'] });
});
