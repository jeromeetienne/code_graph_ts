import { Node, SyntaxKind, } from 'ts-morph';
import { NodeId } from './node-id';
const CALLABLE_TARGET_KINDS = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.MethodSignature,
    SyntaxKind.VariableDeclaration,
]);
const TYPE_DECL_KINDS = new Set([
    SyntaxKind.ClassDeclaration,
    SyntaxKind.InterfaceDeclaration,
    SyntaxKind.TypeAliasDeclaration,
    SyntaxKind.EnumDeclaration,
]);
const VALUE_DECL_KINDS = new Set([
    SyntaxKind.VariableDeclaration,
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.EnumDeclaration,
]);
const SCOPE_KINDS = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.PropertyDeclaration,
    SyntaxKind.PropertySignature,
    SyntaxKind.VariableDeclaration,
    SyntaxKind.TypeAliasDeclaration,
    SyntaxKind.EnumDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.InterfaceDeclaration,
]);
export class SemanticExtractor {
    static extract(sourceFile, rootPath) {
        const edges = [];
        for (const cls of sourceFile.getClasses()) {
            SemanticExtractor.extractClass(cls, rootPath, edges);
        }
        for (const iface of sourceFile.getInterfaces()) {
            SemanticExtractor.extractInterface(iface, rootPath, edges);
        }
        for (const fn of sourceFile.getFunctions()) {
            SemanticExtractor.extractSignature(fn, rootPath, edges);
        }
        for (const variable of sourceFile.getVariableDeclarations()) {
            SemanticExtractor.addTypeEdges(NodeId.forDeclaration(variable, rootPath), variable.getTypeNode(), 'USES_TYPE', rootPath, edges);
        }
        for (const alias of sourceFile.getTypeAliases()) {
            SemanticExtractor.addTypeEdges(NodeId.forDeclaration(alias, rootPath), alias.getTypeNode(), 'USES_TYPE', rootPath, edges);
        }
        SemanticExtractor.extractCalls(sourceFile, rootPath, edges);
        SemanticExtractor.extractInstantiations(sourceFile, rootPath, edges);
        SemanticExtractor.extractReads(sourceFile, rootPath, edges);
        return { nodes: [], edges };
    }
    static extractClass(cls, rootPath, edges) {
        const classId = NodeId.forDeclaration(cls, rootPath);
        const base = cls.getBaseClass();
        if (base !== undefined && SemanticExtractor.inProject(base) === true) {
            edges.push(SemanticExtractor.edge('EXTENDS', classId, NodeId.forDeclaration(base, rootPath)));
        }
        for (const impl of cls.getImplements()) {
            const decl = SemanticExtractor.resolve(impl.getExpression());
            if (decl !== undefined && SemanticExtractor.inProject(decl) === true) {
                edges.push(SemanticExtractor.edge('IMPLEMENTS', classId, NodeId.forDeclaration(decl, rootPath)));
            }
        }
        for (const method of cls.getMethods()) {
            SemanticExtractor.extractSignature(method, rootPath, edges);
        }
        for (const property of cls.getProperties()) {
            SemanticExtractor.addTypeEdges(NodeId.forDeclaration(property, rootPath), property.getTypeNode(), 'USES_TYPE', rootPath, edges);
        }
    }
    static extractInterface(iface, rootPath, edges) {
        const ifaceId = NodeId.forDeclaration(iface, rootPath);
        for (const base of iface.getBaseDeclarations()) {
            if (SemanticExtractor.inProject(base) === true) {
                edges.push(SemanticExtractor.edge('EXTENDS', ifaceId, NodeId.forDeclaration(base, rootPath)));
            }
        }
        for (const method of iface.getMethods()) {
            SemanticExtractor.extractSignature(method, rootPath, edges);
        }
        for (const property of iface.getProperties()) {
            SemanticExtractor.addTypeEdges(NodeId.forDeclaration(property, rootPath), property.getTypeNode(), 'USES_TYPE', rootPath, edges);
        }
    }
    static extractSignature(node, rootPath, edges) {
        const id = NodeId.forDeclaration(node, rootPath);
        SemanticExtractor.addTypeEdges(id, node.getReturnTypeNode(), 'RETURNS', rootPath, edges);
        for (const parameter of node.getParameters()) {
            SemanticExtractor.addTypeEdges(id, parameter.getTypeNode(), 'PARAM_TYPE', rootPath, edges);
        }
    }
    static addTypeEdges(fromId, typeNode, kind, rootPath, edges) {
        if (typeNode === undefined) {
            return;
        }
        for (const decl of SemanticExtractor.referencedTypes(typeNode)) {
            if (SemanticExtractor.inProject(decl) === false || TYPE_DECL_KINDS.has(decl.getKind()) === false) {
                continue;
            }
            edges.push(SemanticExtractor.edge(kind, fromId, NodeId.forDeclaration(decl, rootPath)));
        }
    }
    static referencedTypes(typeNode) {
        const references = typeNode.getDescendantsOfKind(SyntaxKind.TypeReference);
        const self = typeNode.asKind(SyntaxKind.TypeReference);
        if (self !== undefined) {
            references.unshift(self);
        }
        const declarations = [];
        for (const reference of references) {
            const symbol = reference.getTypeName().getSymbol();
            const resolved = symbol?.getAliasedSymbol() ?? symbol;
            const declaration = resolved?.getDeclarations()[0];
            if (declaration !== undefined) {
                declarations.push(declaration);
            }
        }
        return declarations;
    }
    static extractCalls(sourceFile, rootPath, edges) {
        for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const caller = SemanticExtractor.enclosingDeclaration(call);
            if (caller === undefined) {
                continue;
            }
            const callee = SemanticExtractor.resolve(call.getExpression());
            if (callee === undefined || SemanticExtractor.inProject(callee) === false) {
                continue;
            }
            if (CALLABLE_TARGET_KINDS.has(callee.getKind()) === false) {
                continue;
            }
            edges.push(SemanticExtractor.edge('CALLS', NodeId.forDeclaration(caller, rootPath), NodeId.forDeclaration(callee, rootPath)));
        }
    }
    static extractInstantiations(sourceFile, rootPath, edges) {
        for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
            const caller = SemanticExtractor.enclosingDeclaration(expression);
            if (caller === undefined) {
                continue;
            }
            const target = SemanticExtractor.resolve(expression.getExpression());
            if (target === undefined || SemanticExtractor.inProject(target) === false) {
                continue;
            }
            if (target.getKind() !== SyntaxKind.ClassDeclaration) {
                continue;
            }
            edges.push(SemanticExtractor.edge('INSTANTIATES', NodeId.forDeclaration(caller, rootPath), NodeId.forDeclaration(target, rootPath)));
        }
    }
    static extractReads(sourceFile, rootPath, edges) {
        for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
            if (SemanticExtractor.isValueRead(identifier) === false) {
                continue;
            }
            const target = SemanticExtractor.resolve(identifier);
            if (target === undefined || SemanticExtractor.inProject(target) === false) {
                continue;
            }
            if (VALUE_DECL_KINDS.has(target.getKind()) === false || SemanticExtractor.isEmittedTarget(target) === false) {
                continue;
            }
            if (SemanticExtractor.isDeclarationName(identifier, target) === true) {
                continue;
            }
            const scope = SemanticExtractor.readerScope(identifier);
            if (scope === undefined) {
                continue;
            }
            const fromId = NodeId.forDeclaration(scope, rootPath);
            const toId = NodeId.forDeclaration(target, rootPath);
            if (fromId !== toId) {
                edges.push(SemanticExtractor.edge('READS', fromId, toId));
            }
        }
    }
    static isValueRead(identifier) {
        if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined) {
            return false;
        }
        if (identifier.getFirstAncestorByKind(SyntaxKind.HeritageClause) !== undefined) {
            return false;
        }
        const parent = identifier.getParent();
        if (parent === undefined) {
            return false;
        }
        if (Node.isPropertyAccessExpression(parent)) {
            return parent.getNameNode() !== identifier;
        }
        if (Node.isQualifiedName(parent)) {
            return parent.getRight() !== identifier;
        }
        if (Node.isCallExpression(parent) || Node.isNewExpression(parent)) {
            return parent.getExpression() !== identifier;
        }
        if (Node.isPropertyAssignment(parent)) {
            return parent.getNameNode() !== identifier;
        }
        if (Node.isTypeReference(parent) || Node.isPropertySignature(parent) || Node.isPropertyDeclaration(parent) || Node.isBindingElement(parent)) {
            return false;
        }
        return true;
    }
    static isDeclarationName(identifier, declaration) {
        const named = declaration;
        return typeof named.getNameNode === 'function' && named.getNameNode() === identifier;
    }
    static isEmittedTarget(declaration) {
        if (Node.isVariableDeclaration(declaration)) {
            const statement = declaration.getVariableStatement();
            return statement !== undefined && statement.getParent()?.getKind() === SyntaxKind.SourceFile;
        }
        return declaration.getParent()?.getKind() === SyntaxKind.SourceFile;
    }
    static readerScope(node) {
        const executable = node.getFirstAncestor((ancestor) => {
            const kind = ancestor.getKind();
            return kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration;
        });
        if (executable !== undefined) {
            return executable;
        }
        return node.getFirstAncestor((ancestor) => SCOPE_KINDS.has(ancestor.getKind()));
    }
    static enclosingDeclaration(node) {
        return node.getFirstAncestor((ancestor) => {
            const kind = ancestor.getKind();
            return kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration;
        });
    }
    static resolve(node) {
        const symbol = node.getSymbol();
        if (symbol === undefined) {
            return undefined;
        }
        const resolved = symbol.getAliasedSymbol() ?? symbol;
        const declarations = resolved.getDeclarations();
        return declarations.length === 0 ? undefined : declarations[0];
    }
    static inProject(node) {
        const sourceFile = node.getSourceFile();
        return sourceFile.getFilePath().includes('/node_modules/') === false
            && sourceFile.isDeclarationFile() === false;
    }
    static edge(kind, from, to) {
        return { id: `${kind}:${from}->${to}`, kind, from, to };
    }
}
//# sourceMappingURL=semantic-extractor.js.map