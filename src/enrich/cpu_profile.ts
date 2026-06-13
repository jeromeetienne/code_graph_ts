import { z } from 'zod';

/**
 * A single call frame as it appears in a V8 CPU profile node. Line and column
 * numbers are **zero-based** in the V8 inspector protocol, unlike the one-based
 * lines ts-morph (and therefore the graph's `range`) uses.
 */
const CallFrameSchema = z.object({
	functionName: z.string(),
	scriptId: z.union([z.string(), z.number()]).optional(),
	url: z.string(),
	lineNumber: z.number(),
	columnNumber: z.number(),
});

const ProfileNodeSchema = z.object({
	id: z.number(),
	callFrame: CallFrameSchema,
	hitCount: z.number().optional(),
	children: z.array(z.number()).optional(),
});

/**
 * The on-disk shape of a `node --cpu-prof` output (`.cpuprofile`). `samples`
 * holds one profile-node id per sampling tick; `timeDeltas` holds the elapsed
 * microseconds preceding each tick. Both are optional because some producers
 * emit only per-node `hitCount`.
 */
export const CpuProfileSchema = z.object({
	nodes: z.array(ProfileNodeSchema),
	startTime: z.number().optional(),
	endTime: z.number().optional(),
	samples: z.array(z.number()).optional(),
	timeDeltas: z.array(z.number()).optional(),
});
export type CpuProfileData = z.infer<typeof CpuProfileSchema>;

/**
 * One executing location distilled from the profile: its call frame plus the
 * self time and sample count attributed to it. `line` is converted to the
 * one-based convention so it can be compared against graph node ranges.
 */
export type FrameSample = {
	functionName: string;
	url: string;
	line: number;
	column: number;
	samples: number;
	selfMicros: number;
};

/** The minimal frame identity the join needs: a function name, a script url, and a one-based line. */
export type FrameRef = {
	functionName: string;
	url: string;
	line: number;
};

/** One caller → callee relation from the profile's call tree, weighted by the callee's subtree samples. */
export type RuntimeCallEdge = {
	caller: FrameRef;
	callee: FrameRef;
	samples: number;
};

export class CpuProfile {
	/**
	 * Parses and validates raw `.cpuprofile` JSON text. Throws a `ZodError` if
	 * the document does not match the V8 profile shape.
	 */
	static parse(jsonText: string): CpuProfileData {
		return CpuProfileSchema.parse(JSON.parse(jsonText));
	}

	/**
	 * Collapses the profile into one {@link FrameSample} per profile node that
	 * received at least one sample.
	 *
	 * Self time is summed from `timeDeltas`, attributing `timeDeltas[i]` to
	 * `samples[i]` — the standard self-time approximation where total attributed
	 * time equals the sum of all deltas. When `samples`/`timeDeltas` are absent,
	 * it falls back to each node's `hitCount` with zero self time.
	 */
	static aggregate(profile: CpuProfileData): FrameSample[] {
		const samplesByNode = new Map<number, number>();
		const microsByNode = new Map<number, number>();

		const samples = profile.samples;
		if (samples !== undefined && samples.length > 0) {
			const deltas = profile.timeDeltas ?? [];
			for (let index = 0; index < samples.length; index += 1) {
				const nodeId = samples[index];
				samplesByNode.set(nodeId, (samplesByNode.get(nodeId) ?? 0) + 1);
				const delta = deltas[index] ?? 0;
				const safeDelta = delta > 0 ? delta : 0;
				microsByNode.set(nodeId, (microsByNode.get(nodeId) ?? 0) + safeDelta);
			}
		} else {
			for (const node of profile.nodes) {
				const hits = node.hitCount ?? 0;
				if (hits > 0) {
					samplesByNode.set(node.id, hits);
				}
			}
		}

		const frames: FrameSample[] = [];
		for (const node of profile.nodes) {
			const sampleCount = samplesByNode.get(node.id) ?? 0;
			if (sampleCount === 0) {
				continue;
			}
			frames.push({
				functionName: node.callFrame.functionName,
				url: node.callFrame.url,
				line: node.callFrame.lineNumber + 1,
				column: node.callFrame.columnNumber,
				samples: sampleCount,
				selfMicros: microsByNode.get(node.id) ?? 0,
			});
		}
		return frames;
	}

	/** Total number of sampling ticks in the profile, for coverage reporting. */
	static totalSamples(profile: CpuProfileData): number {
		if (profile.samples !== undefined && profile.samples.length > 0) {
			return profile.samples.length;
		}
		return profile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
	}

	/**
	 * Extracts the runtime call graph from the profile's call tree: one edge per
	 * parent → child relation (the parent function was on the stack directly above
	 * the child), weighted by the child's subtree sample count — how much execution
	 * flowed through that call. Frames carry one-based lines so they resolve against
	 * graph node ranges, mirroring {@link aggregate}.
	 */
	static callEdges(profile: CpuProfileData): RuntimeCallEdge[] {
		const subtree = CpuProfile.subtreeSamples(profile);
		const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
		const edges: RuntimeCallEdge[] = [];
		for (const node of profile.nodes) {
			for (const childId of node.children ?? []) {
				const child = nodeById.get(childId);
				if (child === undefined) {
					continue;
				}
				edges.push({
					caller: CpuProfile.frameRef(node.callFrame),
					callee: CpuProfile.frameRef(child.callFrame),
					samples: subtree.get(childId) ?? 0,
				});
			}
		}
		return edges;
	}

	private static frameRef(callFrame: { functionName: string; url: string; lineNumber: number }): FrameRef {
		return { functionName: callFrame.functionName, url: callFrame.url, line: callFrame.lineNumber + 1 };
	}

	/**
	 * Sample count per profile-node id: from the per-tick `samples` array when
	 * present, otherwise each node's `hitCount`. The same weight {@link aggregate}
	 * attributes, keyed here for the call-tree walk.
	 */
	private static samplesByNode(profile: CpuProfileData): Map<number, number> {
		const counts = new Map<number, number>();
		const samples = profile.samples;
		if (samples !== undefined && samples.length > 0) {
			for (const nodeId of samples) {
				counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
			}
			return counts;
		}
		for (const node of profile.nodes) {
			const hits = node.hitCount ?? 0;
			if (hits > 0) {
				counts.set(node.id, hits);
			}
		}
		return counts;
	}

	/**
	 * Total samples in each profile node's subtree (itself plus all descendants)
	 * over the call tree. Iterative post-order with an explicit stack so a deep call
	 * chain cannot overflow, and a guard so a malformed non-tree cannot loop.
	 */
	private static subtreeSamples(profile: CpuProfileData): Map<number, number> {
		const self = CpuProfile.samplesByNode(profile);
		const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
		const subtree = new Map<number, number>();
		for (const root of profile.nodes) {
			if (subtree.has(root.id)) {
				continue;
			}
			const stack = [root.id];
			const onStack = new Set<number>([root.id]);
			while (stack.length > 0) {
				const id = stack[stack.length - 1];
				const children = (nodeById.get(id)?.children ?? []).filter((child) => nodeById.has(child));
				const pending = children.filter((child) => subtree.has(child) === false && onStack.has(child) === false);
				if (pending.length > 0) {
					for (const child of pending) {
						onStack.add(child);
						stack.push(child);
					}
					continue;
				}
				let sum = self.get(id) ?? 0;
				for (const child of children) {
					sum += subtree.get(child) ?? 0;
				}
				subtree.set(id, sum);
				onStack.delete(id);
				stack.pop();
			}
		}
		return subtree;
	}
}
