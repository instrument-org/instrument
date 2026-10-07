import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { jsonSchema, type JSONSchema7, type Schema, zodSchema } from "ai";
import { z } from "zod";

import type { AgentName } from "../agents/types";
import { offersSay } from "../lib/first-line-mode";
import { isForkOnlyEnabled, ONE_AGENT_NAME } from "../lib/one-agent-mode";
import {
  TOOL_ACTIVITY_PARAM_NAME,
  TOOL_EXPLANATION_PARAM_NAME,
  TOOL_SAY_PARAM_NAME,
} from "../constants";

export const BaseInputSchema = z.object({
  // A line to the user riding on a call, which the harness shows as the
  // turn's first text (`lib/first-line-mode.ts`, the `say` mode). First, so a
  // model writing fields in order streams it before the call's work. Offered
  // only under that mode; every other schema leaves it out.
  [TOOL_SAY_PARAM_NAME]: z.string().optional().meta({
    description:
      "If you have not written to the user yet this turn, one short sentence to them about what you are doing. Otherwise leave it empty.",
  }),
  // The phase of work the call belongs to, which the UI draws as a heading over
  // the calls that share it. A field on every call rather than a tool of its
  // own: a heading sent as its own call was always its own step, a model round
  // trip that did nothing else, while a field rides along with work the model
  // was making anyway. Optional and required on the same terms as
  // `explanation`, below, and offered only to agents whose transcript is drawn
  // in phases (`labelsPhases`).
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
 * Validates with Zod (so a missing `activity`, `explanation` or `say` still
 * parses) while emitting a JSON schema that lists each one offered as
 * required, since LLMs will often omit them otherwise.
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
  const {
    [TOOL_ACTIVITY_PARAM_NAME]: activity,
    [TOOL_SAY_PARAM_NAME]: say,
    ...rest
  } = json.properties;
  const properties = {
    ...(say !== undefined && offersSay(agentName)
      ? { [TOOL_SAY_PARAM_NAME]: say }
      : {}),
    ...(labelsPhases(agentName) && activity !== undefined
      ? { [TOOL_ACTIVITY_PARAM_NAME]: activity }
      : {}),
    ...rest,
  };
  const existing = json.required ?? [];
  const missing = [
    TOOL_SAY_PARAM_NAME,
    TOOL_ACTIVITY_PARAM_NAME,
    TOOL_EXPLANATION_PARAM_NAME,
  ].filter((name) => name in properties && !existing.includes(name));
  return { ...json, properties, required: [...missing, ...existing] };
}

/**
 * Whether an agent's calls carry the activity heading: the task agent's, and
 * the one agent's under the fork-only modes, whose own transcript is the work
 * (in the chat and in each fork) and is drawn in phases.
 */
function labelsPhases(agentName: AgentName): boolean {
  return (
    agentName === "main" ||
    (agentName === ONE_AGENT_NAME && isForkOnlyEnabled())
  );
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
