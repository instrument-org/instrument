import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { jsonSchema, type JSONSchema7, type Schema, zodSchema } from "ai";
import { z } from "zod";

export const TOOL_EXPLANATION_PARAM_NAME = "explanation";

export const BaseInputSchema = z.object({
  // Surfaced in the UI so users can see what the agent is doing. Many LLMs
  // skip it when it's optional, so we keep it optional in Zod (to avoid
  // hard-failing on omissions) but advertise it as required in the JSON
  // schema we send to the model via `toolInputSchemaForLLM`.
  [TOOL_EXPLANATION_PARAM_NAME]: z.string().optional().meta({
    description:
      "One short sentence describing what this tool is doing, using present continuous tense (e.g., 'Reading the file', 'Exploring the folder'). Generate this first.",
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
          ? { success: true, value: result.data as z.output<TSchema> }
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
