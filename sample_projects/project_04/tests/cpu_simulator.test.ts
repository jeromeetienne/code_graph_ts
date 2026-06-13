import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CpuSimulator } from '../src/sim/cpu_simulator.js';

test('cpu utilization and server count below capacity', () => {
	const result = new CpuSimulator().evaluate({ dimension: 'cpu', demand: 2000, capacity: 4000 });
	assert.equal(result.utilization, 0.5);
	assert.equal(result.serversNeeded, 1);
	assert.equal(result.saturated, false);
});

test('cpu latency climbs with utilization', () => {
	const light = new CpuSimulator().evaluate({ dimension: 'cpu', demand: 2000, capacity: 4000 });
	const heavy = new CpuSimulator().evaluate({ dimension: 'cpu', demand: 3600, capacity: 4000 });
	assert.ok(heavy.latencyMs > light.latencyMs);
});

test('cpu past capacity saturates, needs more servers, and blows up latency', () => {
	const result = new CpuSimulator().evaluate({ dimension: 'cpu', demand: 5000, capacity: 4000 });
	assert.equal(result.saturated, true);
	assert.equal(result.serversNeeded, 2);
	assert.equal(result.latencyMs, 60000);
});
