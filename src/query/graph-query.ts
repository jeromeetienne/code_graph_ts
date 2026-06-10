import type { KuzuValue } from 'kuzu';
import { KuzuStore } from '../store/kuzu-store.js';

export type SymbolRef = {
	id: string;
	kind: string;
	name: string;
	filePath: string;
	startLine: number;
};

export type NeighborRef = SymbolRef & {
	edgeKind: string;
	direction: 'in' | 'out';
};

const REFERENCE_EDGE_KINDS = "['CALLS', 'IMPLEMENTS', 'EXTENDS', 'USES_TYPE', 'RETURNS', 'PARAM_TYPE', 'INSTANTIATES', 'READS']";

const RETURN_REF = (variable: string): string =>
	`${variable}.id AS id, ${variable}.kind AS kind, ${variable}.name AS name, ${variable}.filePath AS filePath, ${variable}.startLine AS startLine`;

export class GraphQuery {
	private readonly store: KuzuStore;

	constructor(store: KuzuStore) {
		this.store = store;
	}

	async whoCalls(id: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode)-[e:Edge]->(callee:GraphNode {id: $id})
			WHERE e.kind = 'CALLS'
			RETURN ${RETURN_REF('caller')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async calls(id: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (caller:GraphNode {id: $id})-[e:Edge]->(callee:GraphNode)
			WHERE e.kind = 'CALLS'
			RETURN ${RETURN_REF('callee')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async blastRadius(id: string, depth: number): Promise<SymbolRef[]> {
		const bound = GraphQuery.clampDepth(depth);
		const rows = await this.store.run(
			`MATCH (target:GraphNode {id: $id})<-[e:Edge*1..${bound} (r, n | WHERE r.kind = 'CALLS')]-(impacted:GraphNode)
			RETURN DISTINCT ${RETURN_REF('impacted')}
			ORDER BY filePath, startLine`,
			{ id },
		);
		return GraphQuery.toRefs(rows);
	}

	async deadExports(): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode)
			WHERE n.exported = true
			OPTIONAL MATCH (n)<-[selfRef:Edge]-(:GraphNode)
			WHERE selfRef.kind IN ${REFERENCE_EDGE_KINDS}
			WITH n, count(selfRef) AS selfRefs
			OPTIONAL MATCH (n)-[c:Edge]->(member:GraphNode)<-[memberRef:Edge]-(:GraphNode)
			WHERE c.kind = 'CONTAINS' AND memberRef.kind IN ${REFERENCE_EDGE_KINDS}
			WITH n, selfRefs, count(memberRef) AS memberRefs
			WHERE selfRefs = 0 AND memberRefs = 0
			RETURN ${RETURN_REF('n')}
			ORDER BY filePath, startLine`,
		);
		return GraphQuery.toRefs(rows);
	}

	async references(id: string): Promise<NeighborRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode {id: $id})<-[e:Edge]-(other:GraphNode)
			WHERE e.kind IN ${REFERENCE_EDGE_KINDS}
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind
			ORDER BY edgeKind, filePath, startLine`,
			{ id },
		);
		return rows.map((row) => GraphQuery.toNeighbor(row, 'in'));
	}

	async neighborhood(id: string): Promise<NeighborRef[]> {
		const outgoing = await this.store.run(
			`MATCH (center:GraphNode {id: $id})-[e:Edge]->(other:GraphNode)
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind`,
			{ id },
		);
		const incoming = await this.store.run(
			`MATCH (center:GraphNode {id: $id})<-[e:Edge]-(other:GraphNode)
			RETURN ${RETURN_REF('other')}, e.kind AS edgeKind`,
			{ id },
		);
		return [
			...outgoing.map((row) => GraphQuery.toNeighbor(row, 'out')),
			...incoming.map((row) => GraphQuery.toNeighbor(row, 'in')),
		];
	}

	async find(pattern: string): Promise<SymbolRef[]> {
		const rows = await this.store.run(
			`MATCH (n:GraphNode)
			WHERE n.kind <> 'Module' AND lower(n.name) CONTAINS lower($pattern)
			RETURN ${RETURN_REF('n')}
			ORDER BY filePath, startLine
			LIMIT 50`,
			{ pattern },
		);
		return GraphQuery.toRefs(rows);
	}

	private static toRefs(rows: Record<string, KuzuValue>[]): SymbolRef[] {
		return rows.map((row) => GraphQuery.toRef(row));
	}

	private static toRef(row: Record<string, KuzuValue>): SymbolRef {
		return {
			id: String(row.id),
			kind: String(row.kind),
			name: String(row.name),
			filePath: String(row.filePath),
			startLine: Number(row.startLine),
		};
	}

	private static toNeighbor(row: Record<string, KuzuValue>, direction: 'in' | 'out'): NeighborRef {
		return { ...GraphQuery.toRef(row), edgeKind: String(row.edgeKind), direction };
	}

	private static clampDepth(depth: number): number {
		if (Number.isFinite(depth) === false) {
			return 5;
		}
		const floored = Math.floor(depth);
		if (floored < 1) {
			return 1;
		}
		return floored > 50 ? 50 : floored;
	}
}
