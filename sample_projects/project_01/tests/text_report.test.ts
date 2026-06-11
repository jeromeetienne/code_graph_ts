import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextReport } from '../src/report/text_report.js';
import type { Document } from '../src/report/text_report.js';

const doc: Document = {
	title: 'the quick brown fox',
	body: 'a a a b b c',
	tags: ['animals', 'demo'],
};

test('wordStats counts words most-frequent first', () => {
	assert.deepEqual(TextReport.wordStats(doc.body), [
		{ word: 'a', count: 3 },
		{ word: 'b', count: 2 },
		{ word: 'c', count: 1 },
	]);
});

test('headline title-cases, slugifies, and snippets', () => {
	assert.equal(
		TextReport.headline(doc),
		'The Quick Brown Fox [the-quick-brown-fox] — a a a b b c',
	);
});

test('citation keeps only the citable fields', () => {
	assert.deepEqual(TextReport.citation(doc), {
		title: 'the quick brown fox',
		tags: ['animals', 'demo'],
	});
});
