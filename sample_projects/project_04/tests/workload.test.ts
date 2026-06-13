import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workload, DEFAULT_ARRIVAL_RATES } from '../src/workload/workload.js';

test('scaling by the offline fallback factor leaves rates unchanged', () => {
	assert.deepEqual(Workload.scale(DEFAULT_ARRIVAL_RATES, 1), DEFAULT_ARRIVAL_RATES);
});

test('scaling multiplies every route arrival rate', () => {
	assert.deepEqual(Workload.scale({ 'GET /a': 10, 'POST /b': 5 }, 2), { 'GET /a': 20, 'POST /b': 10 });
});
