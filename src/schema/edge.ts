import { z } from 'zod';

export const EDGE_KINDS = [
	'CONTAINS',
	'IMPORTS',
	'EXPORTS',
	'EXTENDS',
	'IMPLEMENTS',
	'USES_TYPE',
	'RETURNS',
	'PARAM_TYPE',
	'CALLS',
	'INSTANTIATES',
	'OVERRIDES',
	'READS',
	'WRITES',
] as const;

export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const GraphEdgeSchema = z.object({
	id: z.string(),
	kind: EdgeKindSchema,
	from: z.string(),
	to: z.string(),
	metadata: z.record(z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
