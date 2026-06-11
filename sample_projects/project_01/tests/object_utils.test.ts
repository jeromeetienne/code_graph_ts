import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectUtils } from '../src/utils/object_utils.js';

test('pick keeps only the requested keys', () => {
	const source = { id: 1, name: 'a', active: true };
	assert.deepEqual(ObjectUtils.pick(source, ['id', 'name']), { id: 1, name: 'a' });
});

test('omit drops the requested keys', () => {
	const source = { id: 1, name: 'a', active: true };
	assert.deepEqual(ObjectUtils.omit(source, ['active']), { id: 1, name: 'a' });
});
