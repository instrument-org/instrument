import type { JSONValue } from "@ai-sdk/provider";

import { type FlexibleSchema, tool, type ToolResultPart } from "ai";
import { type z } from "zod";

import { BaseInputSchema, toolInputSchemaForLLM } from "../../tools/base";
import {
  type AgentTool,
  type AnyAgentTool,
  type ToolName,
} from "../../tools/types";
import { sessionRole } from "../chat/children";
import { executeError } from "../execute-error";
import { unavailableReason } from "./admit";
import {
  type ToolInput,
  type ToolInputSchema,
  type ToolSpec,
  type Where,
} from "./define";

/**
 * A capability's model tool: its input with the fields every call carries,
 * its tool surface's description, output and execute. A call from a role the
 * capability leaves out is refused when it runs, with the capability's own
 * words, since the tool itself is in every session's list.
 */
export function modelTool<
  In extends z.ZodObject,
  Name extends ToolName,
  Stored extends z.ZodType,
>(capability: {
  gate?: unknown;
  input: In;
  name: string;
  surfaces: { tool?: ToolSpec<Name, ToolInput<In>, Stored> };
  where?: Where;
}): AgentTool<Name, ToolInputSchema<In>, Stored> {
  const spec = capability.surfaces.tool;
  if (spec === undefined) {
    throw new Error(`${capability.name} has no tool surface.`);
  }
  if (capability.gate !== undefined) {
    // A gate's answers are a command's exit codes and a script's exceptions;
    // a tool has neither, so one capability does not take both.
    throw new Error(`${capability.name} has a gate, which a tool cannot run.`);
  }
  // The activity and explanation first, so a model generates them first.
  const inputSchema = BaseInputSchema.extend(capability.input.shape);

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
      return spec.toModelOutput({
        // Recorded parts are cast rather than parsed on the way out of the
        // store, so these are the shapes the call was recorded with.
        input: input as ToolInput<In>,
        output: output as z.output<Stored>,
        toolCallId,
      });
    } catch {
      return typeof output === "string"
        ? { type: "text", value: output }
        : { type: "json", value: output as JSONValue };
    }
  };

  const built = (
    description: string,
    schema: FlexibleSchema<Record<string, unknown>>,
  ) =>
    // Our tools take no execution context.
    tool<Record<string, unknown>, unknown, Record<string, never>>({
      description,
      inputSchema: schema,
      outputSchema: spec.output,
      toModelOutput,
      type: "function",
    });

  const agentTool: AnyAgentTool = {
    aiSDKTool: async ({ chatId, model }) =>
      built(
        await (typeof spec.description === "function"
          ? spec.description({ chatId, model })
          : spec.description),
        toolInputSchemaForLLM(inputSchema),
      ),
    description: spec.description,
    execute: (call) => {
      const refused = unavailableReason(
        capability,
        sessionRole(call.chatId, call.sessionId) ?? "task",
      );
      return refused === undefined
        ? spec.execute(call)
        : Promise.resolve(executeError(refused));
    },
    inputSchema,
    name: spec.name,
    outputSchema: spec.output,
    readOnly: spec.readOnly,
    // Never shown to the model: for the static types and `toModelOutput`
    // mapping in `prepareModelMessages`, safe to build without a chat.
    staticAISDKTool: () => built("", inputSchema),
    timeoutMs: (options) => spec.timeoutMs(options),
    toModelOutput: (options) => spec.toModelOutput(options),
  };
  // TypeScript cannot follow zod's `extend` through a generic shape, so the
  // tool is built untyped and given its types here: its input schema is
  // exactly `BaseInputSchema.extend(input.shape)`, which is what
  // `ToolInputSchema<In>` names, and the rest comes from `spec` as typed.
  return agentTool as AgentTool<Name, ToolInputSchema<In>, Stored>;
}
