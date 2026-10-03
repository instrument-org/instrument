import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { jsonSchema, type JSONSchema7, type Schema, zodSchema } from "ai";
import { z } from "zod";

import type { AgentName } from "../agents/types";
import {
  TOOL_ACTIVITY_PARAM_NAME,
  TOOL_EXPLANATION_PARAM_NAME,
} from "../constants";

export const BaseInputSchema = z.object({
  // The phase of work the call belongs to, which the UI draws as a heading over
  // the calls that share it. A field on every call rather than a tool of its
  // own: a heading sent as its own call was always its own step, a model round
  // trip that did nothing else, while a field rides along with work the model
  // was making anyway. Optional and required on the same terms as
  // `explanation`, below, and offered only to the task agent, whose transcript
  // is the one drawn in phases.
  [TOOL_ACTIVITY_PARAM_NAME]: z.string().optional().meta({
    description:
      "The phase of work this call belongs to, as a short heading in the present continuous, under about eight words (e.g. 'Charting the quarterly numbers'). Calls serving one objective repeat the same heading word for word. Generate this first.",
  }),
  // Surfaced in the UI so users can see what the agent is doing. Many LLMs
  // skip it when it's optional, so we keep it optional in Zod (to avoid
  // hard-failing on omissions) but advertise it as required in the JSON
  // schema we send to the model via `toolInputSchemaForLLM`.
  // The shape alone; what the label is for and what it must never be is said
  // once in each agent's prompt, since this description is repeated on every
  // tool of the request.
  [TOOL_EXPLANATION_PARAM_NAME]: z.string().optional().meta({
    description:
      "A label for this call: a short phrase starting with a verb ending in -ing, e.g. 'Reading the sales spreadsheet'. Generate this before the call's other fields.",
  }),
});

/**
 * Validates with Zod (so a missing `activity` or `explanation` still parses)
 * while emitting a JSON schema that lists both as required, since LLMs will
 * often omit them otherwise.
 */
export function toolInputSchemaForLLM<TSchema extends z.ZodType>(
  schema: TSchema,
  agentName: AgentName,
): Schema<z.output<TSchema>> {
  const inner = zodSchema(schema);
  return jsonSchema<z.output<TSchema>>(
    async () => forceLabelsRequired(await inner.jsonSchema, agentName),
    {
      validate: async (value) => {
        const result = await schema.safeParseAsync(value);
        return result.success
          ? { success: true, value: result.data }
          : { error: result.error, success: false };
      },
    },
  );
}

function forceLabelsRequired(
  json: JSONSchema7,
  agentName: AgentName,
): JSONSchema7 {
  if (!json.properties) {
    return json;
  }
  const { [TOOL_ACTIVITY_PARAM_NAME]: activity, ...rest } = json.properties;
  const properties =
    agentName === "main" || activity === undefined ? json.properties : rest;
  const existing = json.required ?? [];
  const missing = [
    TOOL_ACTIVITY_PARAM_NAME,
    TOOL_EXPLANATION_PARAM_NAME,
  ].filter((name) => name in properties && !existing.includes(name));
  return { ...json, properties, required: [...missing, ...existing] };
}

export const ProviderOutputSchema = AIGatewayProviderConfig.Schema.pick({
  displayName: true,
  id: true,
  type: true,
});

const OptionalNumberOrNaN = z.union([z.number(), z.nan()]).optional();

export const UsageOutputSchema = z.object({
  inputTokens: OptionalNumberOrNaN,
  outputTokens: OptionalNumberOrNaN,
  totalTokens: OptionalNumberOrNaN,
});
