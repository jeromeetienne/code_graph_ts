import { relative } from 'node:path';
import { Node } from 'ts-morph';

export class NodeId {
	static forModule(filePath: string, rootPath: string): string {
		return `Module:${relative(rootPath, filePath)}`;
	}

	static forDeclaration(node: Node, rootPath: string): string {
		const filePath = relative(rootPath, node.getSourceFile().getFilePath());
		return `${node.getKindName()}:${filePath}#${NodeId.nameOf(node)}@${node.getStartLineNumber()}`;
	}

	static forExternalModule(specifier: string): string {
		return `External:${specifier}`;
	}

	/**
	 * A graph-wide id for a configuration variable (e.g. `process.env.PORT`), keyed
	 * by name so the same variable read across many files collapses to one node.
	 */
	static forConfigFlag(name: string): string {
		return `Config:${name}`;
	}

	/**
	 * A graph-wide id for an external HTTP target, keyed by host (e.g. the
	 * `api.example.com` of a `fetch('https://api.example.com/…')`) so every call to
	 * the same service collapses to one node.
	 */
	static forExternalApi(host: string): string {
		return `Api:${host}`;
	}

	static nameOf(node: Node): string {
		const probe = node as { getName?: () => string | undefined };
		if (typeof probe.getName !== 'function') {
			return 'anonymous';
		}
		const name = probe.getName();
		return name === undefined || name === '' ? 'anonymous' : name;
	}
}
