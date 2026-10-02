import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { jsonSchema, type JSONSchema7, type Schema, zodSchema } from "ai";
import { z } from "zod";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";

export const BaseInputSchema = z.object({
  // Surfaced in the UI so users can see what the agent is doing. Many LLMs
  // skip it when it's optional, so we keep it optional in Zod (to avoid
  // hard-failing on omissions) but advertise it as required in the JSON
  // schema we send to the model via `toolInputSchemaForLLM`.
  // The shape alone; what the label is for and what it must never be is said
  // once in each agent's prompt, since this description is repeated on every
  // tool of the request.
  [TOOL_EXPLANATION_PARAM_NAME]: z.string().optional().meta({
    description:
      "A label for this call: a short phrase starting with a verb ending in -ing, e.g. 'Reading the sales spreadsheet'. Generate this first.",
  }),
});

/**
 * Validates with Zod (so a missing `explanation` still parses) while emitting
 * a JSON schema that lists `explanation` as required, since LLMs will often
 * omit it otherwise.
 */
export function toolInputSchemaForLLM<TSchema extends z.ZodType>(
  schema: TSchema,
): Schema<z.output<TSchema>> {
  const inner = zodSchema(schema);
  return jsonSchema<z.output<TSchema>>(
    async () => forceExplanationRequired(await inner.jsonSchema),
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

function forceExplanationRequired(json: JSONSchema7): JSONSchema7 {
  if (!json.properties || !(TOOL_EXPLANATION_PARAM_NAME in json.properties)) {
    return json;
  }
  const existing = json.required ?? [];
  if (existing.includes(TOOL_EXPLANATION_PARAM_NAME)) {
    return json;
  }
  return {
    ...json,
    required: [TOOL_EXPLANATION_PARAM_NAME, ...existing],
  };
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
