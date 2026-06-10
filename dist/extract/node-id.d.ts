import { Node } from 'ts-morph';
export declare class NodeId {
    static forModule(filePath: string, rootPath: string): string;
    static forDeclaration(node: Node, rootPath: string): string;
    static forExternalModule(specifier: string): string;
    static nameOf(node: Node): string;
}
//# sourceMappingURL=node-id.d.ts.map