import type { Tool } from "ai";

import { type LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type Result } from "neverthrow";
import { type z } from "zod";

import type { ToolNameSchema } from "./name";

import { type AgentName } from "../agents/types";
import { type ExecuteError } from "../lib/execute-error";
import { type SpawnAgentFunction } from "../lib/spawn-agent";
import { type TaskState } from "../lib/task-state-store";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

export interface AgentTool<
  TName extends ToolName,
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  aiSDKTool: (options: {
    agentName: AgentName;
    model: AIGatewayModel.Type;
    taskId: TaskId;
  }) => Promise<Tool<z.output<TInputSchema>, z.output<TOutputSchema>>>;
  description:
    | ((options: {
        agentName: AgentName;
        model: AIGatewayModel.Type;
        taskId: TaskId;
      }) => Promise<string> | string)
    | string;
  execute: (options: {
    agentName: AgentName;
    input: z.output<TInputSchema>;
    messageId: StoreId.Message;
    model: AIGatewayModel.Type;
    partId: StoreId.Part;
    sessionId: StoreId.Session;
    signal: AbortSignal;
    spawnAgent: SpawnAgentFunction;
    taskId: TaskId;
    taskState: TaskState;
  }) =>
    | AsyncGenerator<ExecuteResult<z.output<TOutputSchema>>>
    | Promise<ExecuteResult<z.output<TOutputSchema>>>;
  inputSchema: ((agentName: AgentName) => TInputSchema) | TInputSchema;
  name: TName;
  outputSchema: TOutputSchema;
  readOnly: boolean;
  // Description-free variant used for static type inference and toModelOutput mapping.
  // Does not call description(), so it is safe to call synchronously without taskId.
  staticAISDKTool: () => Tool<z.output<TInputSchema>, z.output<TOutputSchema>>;
  timeoutMs:
    | ((options: { input: z.output<TInputSchema>; taskId: TaskId }) => number)
    | number;
  toModelOutput: (options: {
    input: z.output<TInputSchema>;
    output: z.output<TOutputSchema>;
    toolCallId: string;
  }) => LanguageModelV2ToolResultOutput;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyAgentTool = AgentTool<any, any, any>;

export type ToolName = z.output<typeof ToolNameSchema>;

type ExecuteResult<T> = Result<T, ExecuteError>;
