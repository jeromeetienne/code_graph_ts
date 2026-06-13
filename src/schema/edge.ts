import { z } from 'zod';

/**
 * The closed edge vocabulary, grouped by layer (mirrors the README graph-model
 * table).
 *
 * Decision (#31 Part 0): keep a closed `z.enum` rather than an extensible kind
 * registry — simple and explicit. Kùzu stores `kind` as a `STRING`, so a new kind
 * needs no schema migration; its only real costs are this enum, the extractor that
 * emits it, and — for edges — whether it joins {@link REFERENCE_EDGE_KINDS}.
 */
export const EDGE_KINDS = [
	// Structural — cheap, always emitted (no symbol resolution).
	'CONTAINS',
	'IMPORTS',
	'EXPORTS',
	// Type — require symbol resolution, emitted with `--semantic`.
	'EXTENDS',
	'IMPLEMENTS',
	'USES_TYPE',
	'RETURNS',
	'PARAM_TYPE',
	// Behavioral — require symbol resolution, emitted with `--semantic`.
	'CALLS',
	'INSTANTIATES',
	'OVERRIDES',
	'READS',
	'WRITES',
	// System-level — detection-gated entities (#31 Part 2+).
	'READS_CONFIG',
	'CALLS_EXTERNAL',
	'HANDLES',
	// Runtime — observed dynamically, emitted by `enrich` from a CPU profile.
	'CALLS_RUNTIME',
] as const;

export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/**
 * One-line, onboarding-oriented descriptions for every {@link EdgeKind}, keyed by
 * kind. This is the single source of truth surfaced as hover tooltips in the web
 * visualisation; the `Record<EdgeKind, string>` type makes adding an edge kind
 * without describing it a compile error.
 */
export const EDGE_KIND_DESCRIPTIONS: Record<EdgeKind, string> = {
	CONTAINS: 'Structural nesting: the source declares or encloses the target (a module contains a class, which contains a method).',
	IMPORTS: 'The source module imports the target.',
	EXPORTS: 'The source module exports the target symbol.',
	EXTENDS: 'The source class or interface extends the target (inheritance).',
	IMPLEMENTS: 'The source class implements the target interface.',
	USES_TYPE: 'The source references the target in a type position.',
	RETURNS: 'The target type appears in the source function or method return type.',
	PARAM_TYPE: 'The target type appears in one of the source parameter types.',
	CALLS: 'The source function or method calls the target.',
	INSTANTIATES: 'The source constructs the target class with new.',
	OVERRIDES: 'The source method overrides the base-class member it replaces.',
	READS: 'The source reads the value of the target variable or property.',
	WRITES: 'The source assigns to the target variable or property.',
	READS_CONFIG: 'The source reads the target configuration flag (an environment variable).',
	CALLS_EXTERNAL: 'The source makes an outbound HTTP call to the target external API.',
	HANDLES: 'Links an HTTP endpoint to the function that handles it (route to handler).',
	CALLS_RUNTIME: 'A call observed at runtime in a CPU profile: the source function or method was on the stack directly above the target. Captures dynamic dispatch that static CALLS cannot see.',
};

/**
 * The edge kinds that count as a *reference* to their target — the single source
 * of truth for {@link GraphQuery.references} and the {@link GraphQuery.deadExports}
 * liveness check (the query layer derives its Cypher list from this array).
 *
 * An edge kind is a reference when its presence means the target symbol is *used*:
 * a call, a heritage link, a type mention, an instantiation, a value read, a method
 * override (an override uses the base member it replaces), or an endpoint→handler
 * link (`HANDLES` — a route uses the function that handles it). Deliberately
 * excluded:
 * - `CONTAINS` / `IMPORTS` — containment and module wiring, not use;
 * - `EXPORTS` — marks a symbol as exported; counting it would give every export an
 *   inbound edge from its module and defeat dead-export detection;
 * - `WRITES` — mutating a binding is not using its value;
 * - `READS_CONFIG` / `CALLS_EXTERNAL` — their targets are synthesized system-level
 *   nodes (a `ConfigFlag`, an `ExternalAPI`), not code symbols subject to
 *   dead-export analysis.
 */
export const REFERENCE_EDGE_KINDS = [
	'CALLS',
	'EXTENDS',
	'IMPLEMENTS',
	'USES_TYPE',
	'RETURNS',
	'PARAM_TYPE',
	'INSTANTIATES',
	'READS',
	'OVERRIDES',
	'HANDLES',
] as const satisfies readonly EdgeKind[];

export const GraphEdgeSchema = z.object({
	id: z.string(),
	kind: EdgeKindSchema,
	from: z.string(),
	to: z.string(),
	metadata: z.record(z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
