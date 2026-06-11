import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StringUtils } from '../src/utils/string_utils.js';
import { ELLIPSIS } from '../src/shared/constants.js';
import type { TruncateOptions } from '../src/shared/types.js';

test('capitalize upper-cases the first character', () => {
	assert.equal(StringUtils.capitalize('hello'), 'Hello');
	assert.equal(StringUtils.capitalize(''), '');
});

test('normalizeWhitespace collapses runs and trims', () => {
	assert.equal(StringUtils.normalizeWhitespace('  a   b  '), 'a b');
});

test('titleCase capitalizes each word', () => {
	assert.equal(StringUtils.titleCase('the quick   brown'), 'The Quick Brown');
});

test('truncate appends the configured ellipsis when shortened', () => {
	const options: TruncateOptions = { length: 5, ellipsis: '...' };
	assert.equal(StringUtils.truncate('hello world', options), 'hello...');
});

test('truncate falls back to the default ellipsis', () => {
	const options: TruncateOptions = { length: 5, ellipsis: '' };
	assert.equal(StringUtils.truncate('hello world', options), 'hello' + ELLIPSIS);
});

test('truncate leaves short strings untouched', () => {
	const options: TruncateOptions = { length: 20, ellipsis: '...' };
	assert.equal(StringUtils.truncate('short', options), 'short');
});

test('slugify produces a url-friendly slug', () => {
	assert.equal(StringUtils.slugify('  Hello, World!  '), 'hello-world');
});
