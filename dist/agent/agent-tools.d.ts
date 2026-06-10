import OpenAI from 'openai';
import { GraphQuery } from '../query/graph-query';
export declare const PROPOSE_TOOL_NAME = "propose_optimization";
export declare const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[];
export declare class AgentTools {
    private readonly query;
    private readonly rootPath;
    constructor(query: GraphQuery, rootPath: string);
    dispatch(name: string, input: Record<string, unknown>): Promise<string>;
    private readFile;
    private static stringify;
}
//# sourceMappingURL=agent-tools.d.ts.map