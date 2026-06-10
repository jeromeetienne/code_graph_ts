import { z } from 'zod';
export declare const EDGE_KINDS: readonly ["CONTAINS", "IMPORTS", "EXPORTS", "EXTENDS", "IMPLEMENTS", "USES_TYPE", "RETURNS", "PARAM_TYPE", "CALLS", "INSTANTIATES", "OVERRIDES", "READS", "WRITES"];
export declare const EdgeKindSchema: z.ZodEnum<["CONTAINS", "IMPORTS", "EXPORTS", "EXTENDS", "IMPLEMENTS", "USES_TYPE", "RETURNS", "PARAM_TYPE", "CALLS", "INSTANTIATES", "OVERRIDES", "READS", "WRITES"]>;
export type EdgeKind = z.infer<typeof EdgeKindSchema>;
export declare const GraphEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["CONTAINS", "IMPORTS", "EXPORTS", "EXTENDS", "IMPLEMENTS", "USES_TYPE", "RETURNS", "PARAM_TYPE", "CALLS", "INSTANTIATES", "OVERRIDES", "READS", "WRITES"]>;
    from: z.ZodString;
    to: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "CONTAINS" | "IMPORTS" | "EXPORTS" | "EXTENDS" | "IMPLEMENTS" | "USES_TYPE" | "RETURNS" | "PARAM_TYPE" | "CALLS" | "INSTANTIATES" | "OVERRIDES" | "READS" | "WRITES";
    from: string;
    to: string;
    metadata?: Record<string, unknown> | undefined;
}, {
    id: string;
    kind: "CONTAINS" | "IMPORTS" | "EXPORTS" | "EXTENDS" | "IMPLEMENTS" | "USES_TYPE" | "RETURNS" | "PARAM_TYPE" | "CALLS" | "INSTANTIATES" | "OVERRIDES" | "READS" | "WRITES";
    from: string;
    to: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
//# sourceMappingURL=edge.d.ts.map