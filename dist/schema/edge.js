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
];
export const EdgeKindSchema = z.enum(EDGE_KINDS);
export const GraphEdgeSchema = z.object({
    id: z.string(),
    kind: EdgeKindSchema,
    from: z.string(),
    to: z.string(),
    metadata: z.record(z.unknown()).optional(),
});
//# sourceMappingURL=edge.js.map