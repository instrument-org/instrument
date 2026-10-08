import type { Tool, ToolResultPart } from "ai";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type Result } from "neverthrow";
import { type z } from "zod";

import type { ToolNameSchema } from "./name";

import { type ExecuteError } from "../lib/execute-error";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type TaskState } from "../schemas/task-state";

export interface AgentTool<
  TName extends ToolName,
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  aiSDKTool: (options: {
    model: AIGatewayModel.Type;
    taskId: TaskId;
  }) => Promise<Tool<z.output<TInputSchema>, z.output<TOutputSchema>>>;
  description:
    | ((options: {
        model: AIGatewayModel.Type;
        taskId: TaskId;
      }) => Promise<string> | string)
    | string;
  execute: (options: {
    input: z.output<TInputSchema>;
    messageId: StoreId.Message;
    model: AIGatewayModel.Type;
    partId: StoreId.Part;
    sessionId: StoreId.Session;
    signal: AbortSignal;
    taskId: TaskId;
    taskState: TaskState;
  }) =>
    | AsyncGenerator<ExecuteResult<z.output<TOutputSchema>>>
    | Promise<ExecuteResult<z.output<TOutputSchema>>>;
  inputSchema: TInputSchema;
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
  }) => ToolResultPart["output"];
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyAgentTool = AgentTool<any, any, any>;

export type ToolName = z.output<typeof ToolNameSchema>;

type ExecuteResult<T> = Result<T, ExecuteError>;
