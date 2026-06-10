import { relative } from 'node:path';
export class NodeId {
    static forModule(filePath, rootPath) {
        return `Module:${relative(rootPath, filePath)}`;
    }
    static forDeclaration(node, rootPath) {
        const filePath = relative(rootPath, node.getSourceFile().getFilePath());
        return `${node.getKindName()}:${filePath}#${NodeId.nameOf(node)}@${node.getStartLineNumber()}`;
    }
    static forExternalModule(specifier) {
        return `External:${specifier}`;
    }
    static nameOf(node) {
        const probe = node;
        if (typeof probe.getName !== 'function') {
            return 'anonymous';
        }
        const name = probe.getName();
        return name === undefined || name === '' ? 'anonymous' : name;
    }
}
//# sourceMappingURL=node-id.js.map