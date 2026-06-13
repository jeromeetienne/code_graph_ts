import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from '../src/sim/simulator.js';
import { ROUTE_PROFILES } from '../src/endpoints/registry.js';
import { DEFAULT_ARRIVAL_RATES } from '../src/workload/workload.js';
import { loadHardware } from '../src/config/hardware.js';

test('the default workload is CPU-bottlenecked and needs two servers', () => {
	const result = Simulator.run(ROUTE_PROFILES, DEFAULT_ARRIVAL_RATES, loadHardware());
	assert.equal(result.bottleneck, 'cpu');
	assert.equal(result.totalServers, 2);
	assert.equal(result.totalArrivalRate, 470);
});

test('per-dimension demand sums arrivalRate × per-request cost', () => {
	const result = Simulator.run(ROUTE_PROFILES, DEFAULT_ARRIVAL_RATES, loadHardware());
	const demandFor = (dimension: string): number =>
		result.perDimension.find((entry) => entry.dimension === dimension)?.demand ?? -1;
	assert.equal(demandFor('cpu'), 4880);
	assert.equal(demandFor('network'), 10270);
	assert.equal(demandFor('disk'), 1980);
});
