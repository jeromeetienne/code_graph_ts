import { z } from 'zod';
export declare const NODE_KINDS: readonly ["Module", "Class", "Interface", "TypeAlias", "Enum", "Function", "Method", "Property", "Parameter", "Variable", "ExternalModule"];
export declare const NodeKindSchema: z.ZodEnum<["Module", "Class", "Interface", "TypeAlias", "Enum", "Function", "Method", "Property", "Parameter", "Variable", "ExternalModule"]>;
export type NodeKind = z.infer<typeof NodeKindSchema>;
export declare const RangeSchema: z.ZodObject<{
    startLine: z.ZodNumber;
    startColumn: z.ZodNumber;
    endLine: z.ZodNumber;
    endColumn: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}, {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}>;
export type Range = z.infer<typeof RangeSchema>;
export declare const GraphNodeSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["Module", "Class", "Interface", "TypeAlias", "Enum", "Function", "Method", "Property", "Parameter", "Variable", "ExternalModule"]>;
    name: z.ZodString;
    filePath: z.ZodString;
    range: z.ZodOptional<z.ZodObject<{
        startLine: z.ZodNumber;
        startColumn: z.ZodNumber;
        endLine: z.ZodNumber;
        endColumn: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    }, {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    }>>;
    exported: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "Module" | "Class" | "Interface" | "TypeAlias" | "Enum" | "Function" | "Method" | "Property" | "Parameter" | "Variable" | "ExternalModule";
    name: string;
    filePath: string;
    metadata?: Record<string, unknown> | undefined;
    range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | undefined;
    exported?: boolean | undefined;
}, {
    id: string;
    kind: "Module" | "Class" | "Interface" | "TypeAlias" | "Enum" | "Function" | "Method" | "Property" | "Parameter" | "Variable" | "ExternalModule";
    name: string;
    filePath: string;
    metadata?: Record<string, unknown> | undefined;
    range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | undefined;
    exported?: boolean | undefined;
}>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
//# sourceMappingURL=node.d.ts.map