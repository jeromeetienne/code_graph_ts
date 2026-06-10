export type VerifyResult = {
    ok: boolean;
    output: string;
};
export declare class Verifier {
    static typecheck(rootPath: string): Promise<VerifyResult>;
    private static runCommand;
}
//# sourceMappingURL=verifier.d.ts.map