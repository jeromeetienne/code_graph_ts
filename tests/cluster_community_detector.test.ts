import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CommunityDetector, WeightedEdge } from '../src/cluster/community_detector.js';

/** Every undirected pair within a fully-connected clique, each edge weight 3. */
function clique(prefix: string, size: number): WeightedEdge[] {
	const ids = Array.from({ length: size }, (_, i) => `${prefix}${i}`);
	const edges: WeightedEdge[] = [];
	for (let i = 0; i < ids.length; i += 1) {
		for (let j = i + 1; j < ids.length; j += 1) {
			edges.push({ from: ids[i], to: ids[j], weight: 3 });
		}
	}
	return edges;
}

const OPTIONS = { resolution: 1, iterations: 10, randomStarts: 10 };

describe('CommunityDetector', () => {
	it('separates two cliques joined by a single bridge edge', () => {
		const edges: WeightedEdge[] = [
			...clique('a', 4),
			...clique('b', 4),
			{ from: 'a0', to: 'b0', weight: 3 },
		];

		const result = CommunityDetector.detect(edges, OPTIONS);

		assert.equal(result.communityCount, 2);
		const communityA = result.communityOf.get('a0');
		const communityB = result.communityOf.get('b0');
		assert.notEqual(communityA, communityB);
		for (const node of ['a1', 'a2', 'a3']) {
			assert.equal(result.communityOf.get(node), communityA);
		}
		for (const node of ['b1', 'b2', 'b3']) {
			assert.equal(result.communityOf.get(node), communityB);
		}
	});

	it('assigns every node touched by an edge to a community', () => {
		const edges: WeightedEdge[] = [...clique('a', 4), ...clique('b', 4), { from: 'a0', to: 'b0', weight: 3 }];
		const result = CommunityDetector.detect(edges, OPTIONS);
		assert.equal(result.communityOf.size, 8);
	});

	it('ignores edge direction: a mutual call is one undirected edge', () => {
		const edges: WeightedEdge[] = [
			{ from: 'x', to: 'y', weight: 3 },
			{ from: 'y', to: 'x', weight: 3 },
			...clique('b', 4),
			{ from: 'y', to: 'b0', weight: 1 },
		];
		const result = CommunityDetector.detect(edges, OPTIONS);
		// x and y are bound only to each other (combined weight 6) and stay together.
		assert.equal(result.communityOf.get('x'), result.communityOf.get('y'));
		assert.notEqual(result.communityOf.get('x'), result.communityOf.get('b0'));
	});

	it('returns an empty result for no edges', () => {
		const result = CommunityDetector.detect([], OPTIONS);
		assert.equal(result.communityCount, 0);
		assert.equal(result.communityOf.size, 0);
		assert.deepEqual(result.sizes, []);
	});
});
