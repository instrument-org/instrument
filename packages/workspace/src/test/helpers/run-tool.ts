import { type Result } from "neverthrow";
import { type output } from "zod";

import { type ExecuteError } from "../../lib/execute-error";
import { streamTool } from "../../lib/stream-tool";
import { StoreId } from "../../schemas/store-id";
import { type AgentTool, type AnyAgentTool } from "../../tools/types";

type ExecuteOptions<T extends AnyAgentTool> = Parameters<T["execute"]>[0];
type ExecuteOutput<T extends AnyAgentTool> =
  T extends AgentTool<infer _N, infer _I, infer O>
    ? Result<output<O>, ExecuteError>
    : never;

export async function runTool<T extends AnyAgentTool>(
  tool: T,
  options: Omit<ExecuteOptions<T>, "messageId" | "partId" | "sessionId"> & {
    messageId?: StoreId.Message;
    partId?: StoreId.Part;
    sessionId?: StoreId.Session;
  },
): Promise<ExecuteOutput<T>> {
  const executeOptions = {
    messageId: StoreId.newMessageId(),
    partId: StoreId.newPartId(),
    sessionId: StoreId.newSessionId(),
    ...options,
  };
  for await (const { output: result, type } of streamTool({
    execute: tool.execute,
    options: executeOptions,
  })) {
    if (type === "final") {
      return result as ExecuteOutput<T>;
    }
  }
  throw new Error("Tool produced no final output");
}
