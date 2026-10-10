import type { JSONValue } from "@ai-sdk/provider";
import type * as z from "zod";

import { tool, type ToolResultPart } from "ai";

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
  inputSchema: TInputSchema;
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
  }): ToolResultPart["output"] => {
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
    aiSDKTool: async ({ model, chatId }) => {
      const description = await (typeof options.description === "function"
        ? options.description({ model, chatId })
        : options.description);

      return (
        // Our tools take no execution context.
        tool<
          z.output<TInputSchema>,
          z.output<TOutputSchema>,
          Record<string, never>
        >({
          description,
          inputSchema: toolInputSchemaForLLM(setup.inputSchema),
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
    staticAISDKTool: () =>
      tool<
        z.output<TInputSchema>,
        z.output<TOutputSchema>,
        Record<string, never>
      >({
        description: "", // None because this is never shown to agent
        inputSchema: setup.inputSchema,
        outputSchema: setup.outputSchema,
        toModelOutput,
        type: "function",
      }),
  };
}
