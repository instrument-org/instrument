import type {
  JSONValue,
  LanguageModelV2ToolResultOutput,
} from "@ai-sdk/provider";
import type * as z from "zod";

import { tool } from "ai";

import type { AgentName } from "../agents/types";
import type { AgentTool, ToolName } from "./types";

import { toolInputSchemaForLLM } from "./base";

type CreateOptions<
  TName extends ToolName,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> = Omit<
  AgentTool<TName, TInputSchema, TOutputSchema>,
  "aiSDKTool" | "inputSchema" | "name" | "outputSchema" | "staticAISDKTool"
>;

interface SetupOptions<
  TName extends ToolName,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  inputSchema: ((agentName: AgentName) => TInputSchema) | TInputSchema;
  name: TName;
  outputSchema: TOutputSchema;
}

export function setupTool<
  TName extends ToolName,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(setup: SetupOptions<TName, TInputSchema, TOutputSchema>) {
  return {
    create: (
      options: CreateOptions<TName, TInputSchema, TOutputSchema>,
    ): AgentTool<TName, TInputSchema, TOutputSchema> =>
      buildTool(setup, options),
  };
}

function buildTool<
  TName extends ToolName,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  setup: SetupOptions<TName, TInputSchema, TOutputSchema>,
  options: CreateOptions<TName, TInputSchema, TOutputSchema>,
): AgentTool<TName, TInputSchema, TOutputSchema> {
  // A tool's output schema moves on while sessions recorded against older
  // shapes stay on disk, and every one of their parts is converted again on
  // each turn and each transcript render. Reading a field the record predates
  // throws, so without this one stale part fails the whole conversion. Handing
  // the raw output back keeps the rest of the conversation intact, and matches
  // what the AI SDK does for a tool that declares no mapping at all.
  const toModelOutput = ({
    input,
    output,
    toolCallId,
  }: {
    input: unknown;
    output: unknown;
    toolCallId: string;
  }): LanguageModelV2ToolResultOutput => {
    try {
      return options.toModelOutput({
        input: input as z.output<TInputSchema>,
        output: output as z.output<TOutputSchema>,
        toolCallId,
      });
    } catch {
      return typeof output === "string"
        ? { type: "text", value: output }
        : { type: "json", value: output as JSONValue };
    }
  };

  return {
    ...setup,
    ...options,
    aiSDKTool: async ({ agentName, model, taskId }) => {
      const description = await (typeof options.description === "function"
        ? options.description({ agentName, model, taskId })
        : options.description);

      const inputSchema =
        typeof setup.inputSchema === "function"
          ? setup.inputSchema(agentName)
          : setup.inputSchema;

      return (
        // Ideally we wouldn't cast, but this isn't needed because the generic
        // is declared in the type
        // oxlint-disable-next-line typescript/no-explicit-any
        tool<any, any>({
          description,
          inputSchema: toolInputSchemaForLLM(inputSchema),
          outputSchema: setup.outputSchema,
          toModelOutput,
          type: "function",
        })
      );
    },
    /**
     * Builds a description-free AI SDK tool shape used exclusively for
     * `toModelOutput` mapping in `prepareModelMessages`. Do not use this
     * for constructing tools passed to the LLM -- use `aiSDKTool` instead.
     */
    staticAISDKTool: () => {
      const inputSchema =
        typeof setup.inputSchema === "function"
          ? setup.inputSchema("main")
          : setup.inputSchema;

      return (
        // oxlint-disable-next-line typescript/no-explicit-any
        tool<any, any>({
          description: "", // None because this is never shown to agent
          inputSchema,
          outputSchema: setup.outputSchema,
          toModelOutput,
          type: "function",
        })
      );
    },
  };
}
