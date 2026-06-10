import { SourceFile } from 'ts-morph';
import { Extraction } from './structural-extractor';
export declare class SemanticExtractor {
    static extract(sourceFile: SourceFile, rootPath: string): Extraction;
    private static extractClass;
    private static extractInterface;
    private static extractSignature;
    private static addTypeEdges;
    private static referencedTypes;
    private static extractCalls;
    private static extractInstantiations;
    private static extractReads;
    private static isValueRead;
    private static isDeclarationName;
    private static isEmittedTarget;
    private static readerScope;
    private static enclosingDeclaration;
    private static resolve;
    private static inProject;
    private static edge;
}
//# sourceMappingURL=semantic-extractor.d.ts.map