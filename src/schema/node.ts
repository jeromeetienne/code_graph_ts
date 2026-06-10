import { z } from 'zod';

export const NODE_KINDS = [
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
	'ExternalModule',
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
