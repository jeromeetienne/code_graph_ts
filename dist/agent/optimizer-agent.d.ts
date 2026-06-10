import { AgentTools } from './agent-tools';
import { CodeEditor } from './code-editor';
export type AppliedEdit = {
    filePath: string;
    rationale: string;
};
export type OptimizeOutcome = {
    applied: AppliedEdit[];
    transcript: string[];
};
export type OptimizerParams = {
    tools: AgentTools;
    editor: CodeEditor;
    rootPath: string;
    model: string;
    maxSteps?: number;
};
export declare class OptimizerAgent {
    private readonly client;
    private readonly tools;
    private readonly editor;
    private readonly rootPath;
    private readonly model;
    private readonly maxSteps;
    constructor(params: OptimizerParams);
    run(task: string): Promise<OptimizeOutcome>;
    private applyAndVerify;
    private static parseArguments;
}
//# sourceMappingURL=optimizer-agent.d.ts.map