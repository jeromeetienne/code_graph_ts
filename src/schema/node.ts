import { z } from 'zod';

/**
 * The closed node vocabulary. See {@link EDGE_KINDS} in `edge.ts` for the
 * closed-enum-vs-registry decision (#31 Part 0); the same reasoning applies here.
 *
 * The system-level group grows one detection-gated extractor at a time (#31).
 * `ConfigFlag` (environment variables) is the first; `Endpoint`, `DatabaseTable`,
 * `QueueTopic`, and `ExternalAPI` arrive in later slices.
 */
export const NODE_KINDS = [
	// Code structure.
	'Module',
	'Class',
	'Interface',
	'TypeAlias',
	'Enum',
	'Function',
	'Method',
	'Property',
	'Parameter',
	'Variable',
	// External dependencies, as one opaque node per import specifier.
	'ExternalModule',
	// System-level entities — detection-gated (#31 Part 2+).
	'ConfigFlag',
	'ExternalAPI',
] as const;

export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const RangeSchema = z.object({
	startLine: z.number().int(),
	startColumn: z.number().int(),
	endLine: z.number().int(),
	endColumn: z.number().int(),
});
export type Range = z.infer<typeof RangeSchema>;

export const GraphNodeSchema = z.object({
	id: z.string(),
	kind: NodeKindSchema,
	name: z.string(),
	filePath: z.string(),
	range: RangeSchema.optional(),
	exported: z.boolean().optional(),
	metadata: z.record(z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;
