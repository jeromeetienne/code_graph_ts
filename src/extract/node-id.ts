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

	static nameOf(node: Node): string {
		const probe = node as { getName?: () => string | undefined };
		if (typeof probe.getName !== 'function') {
			return 'anonymous';
		}
		const name = probe.getName();
		return name === undefined || name === '' ? 'anonymous' : name;
	}
}
