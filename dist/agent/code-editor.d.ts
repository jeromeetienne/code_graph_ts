export type EditRequest = {
    filePath: string;
    find: string;
    replace: string;
};
export type EditResult = {
    ok: boolean;
    message: string;
};
export declare class CodeEditor {
    private readonly rootPath;
    private readonly backups;
    constructor(rootPath: string);
    apply(request: EditRequest): Promise<EditResult>;
    revert(filePath: string): Promise<void>;
    private static readSafe;
}
//# sourceMappingURL=code-editor.d.ts.map