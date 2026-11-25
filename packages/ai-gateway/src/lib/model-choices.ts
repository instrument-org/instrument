import { type SharedV2ProviderOptions } from "@ai-sdk/provider";
import { type AIProviderType, OUR_MODELS } from "@instrument-org/shared";
import { z } from "zod";

import { type AIGatewayModel } from "../schemas/model";
import { type ModelChoice } from "../schemas/model-choice";
import { catalogEffort, effortProviderOptions } from "./reasoning-effort";
import { fastModeDisabledReason } from "./reported-fast-mode";

/**
 * What a person may choose about a model (how hard it thinks, and a faster
 * mode), and the request that asks for it. A Claude or ChatGPT account's levels
 * and OpenRouter's come from their own models lists, and Instrument's and an
 * API key's from our API. A model nothing is known about offers nothing.
 */

const ServedSchema = z.object({
  connections: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.string()).optional(),
      models: z
        .record(
          z.string(),
          z.object({
            defaultEffort: z.string().optional(),
            efforts: z.array(z.string()),
            fast: z.record(z.string(), z.string()).optional(),
          }),
        )
        .optional(),
      refusedEfforts: z.array(z.string()).optional(),
    }),
  ),
});

type Served = z.output<typeof ServedSchema>;

let served: Served = { connections: {} };

/** Uses the settings our API serves, or keeps the last ones when these do not parse. */
export function applyServedModelSettings(document: unknown): boolean {
  const parsed = ServedSchema.safeParse(document);
  if (parsed.success) {
    served = parsed.data;
  }
  return parsed.success;
}

/** Every level a person is offered, lowest first, and its name where our API gives none. */
const LABELS: [effort: string, label: string][] = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
];

/** The levels this build's SDK can send, for each kind of connection that offers any. */
const SENDABLE: Partial<Record<AIProviderType, readonly string[]>> = {
  anthropic: ["low", "medium", "high", "xhigh", "max"],
  "chatgpt-account": ["low", "medium", "high", "xhigh", "max"],
  "claude-account": ["low", "medium", "high", "xhigh", "max"],
  google: ["low", "medium", "high"],
  openai: ["low", "medium", "high", "xhigh", "max"],
  openrouter: ["low", "medium", "high", "xhigh", "max"],
  [OUR_MODELS.providerType]: ["low", "medium", "high", "xhigh", "max"],
  "x-ai": ["low", "medium", "high", "xhigh"],
};

/** What to say of the reasons Claude gives that a person can act on. */
const FAST_OFF: Record<string, { note: string; row: string }> = {
  extra_usage_disabled: {
    note: "Fast is off because usage credits are off for your Claude account.",
    row: "Usage credits are off",
  },
  free: {
    note: "Fast is off because it needs a paid Claude plan.",
    row: "Needs a paid plan",
  },
  preference: {
    note: "Fast is off for your Claude organization.",
    row: "Off for your organization",
  },
};
const FAST_OFF_OTHERWISE = {
  note: "Fast isn’t available on your Claude account right now.",
  row: "Not available",
};

type ServedModels = Served["connections"][string]["models"];

/** A snapshot's date, as OpenAI (`-2025-08-07`) and Anthropic (`-20250929`) write it. */
const SNAPSHOT_DATE = /-20\d{2}(?:-\d{2}-\d{2}|\d{4})$/;

/**
 * What our API serves for a provider's model id, which Google's own list
 * prefixes with `models/`. A dated snapshot not served by its own id is the
 * model it is a snapshot of.
 */
function servedModel(models: ServedModels, providerId: string) {
  const id = providerId.replace(/^models\//, "");
  return models?.[id] ?? models?.[id.replace(SNAPSHOT_DATE, "")];
}

/** The level OpenRouter runs a model at unasked, for one that reasons unasked. */
function openRouterDefault({ reasoning }: AIGatewayModel.Type) {
  return reasoning?.enabledByDefault || reasoning?.mandatory
    ? reasoning.defaultEffort
    : undefined;
}

export function modelChoicesFor(
  model: AIGatewayModel.Type,
): AIGatewayModel.Choices | undefined {
  const provider = model.params.provider;
  const connection = served.connections[provider];
  const keyed = servedModel(connection?.models, model.providerId);
  const sendable = SENDABLE[provider];
  if (!sendable) {
    return undefined;
  }
  const isAccount =
    provider === "chatgpt-account" || provider === "claude-account";
  const listsOwn = isAccount || provider === "openrouter";
  const listed = listsOwn
    ? (model.reasoning?.efforts ?? [])
    : provider === OUR_MODELS.providerType
      ? (model.offeredEfforts ?? [])
      : (keyed?.efforts ?? []);
  const refused = connection?.refusedEfforts ?? [];
  const labels = new Map(
    LABELS.map(([id, label]) => [id, connection?.labels?.[id] ?? label]),
  );
  const efforts = LABELS.flatMap(([id]) =>
    listed.includes(id) && sendable.includes(id) && !refused.includes(id)
      ? [
          {
            description: model.reasoning?.descriptions?.[id],
            id,
            label: labels.get(id) ?? id,
          },
        ]
      : [],
  );
  const runsAt =
    provider === "claude-account"
      ? model.reasoning?.defaultEffort
      : provider === "openrouter"
        ? openRouterDefault(model)
        : (keyed?.defaultEffort ?? catalogEffort(model));
  const fast = isAccount ? model.fast : keyed?.fast && {};
  const reason = fastModeDisabledReason(model.params.providerConfigId);
  if (efforts.length < 2 && !fast) {
    return undefined;
  }
  return {
    // One level is no choice.
    efforts: efforts.length < 2 ? [] : efforts,
    ...(runsAt !== undefined &&
      labels.has(runsAt) && { defaultLabel: labels.get(runsAt) }),
    ...(fast && {
      fast: {
        ...fast,
        ...(reason !== undefined && {
          off: FAST_OFF[reason] ?? FAST_OFF_OTHERWISE,
        }),
      },
    }),
  };
}

/**
 * What of `choice` `model` takes: nothing of one made for another model, no
 * level it does not offer, and no Fast its account cannot run.
 */
export function takenChoice(
  model: AIGatewayModel.Type,
  choice: ModelChoice | undefined,
): { effort?: string; fast?: true } {
  if (
    !choice ||
    choice.model !== model.canonicalId ||
    choice.provider !== model.params.provider
  ) {
    return {};
  }
  const choices = modelChoicesFor(model);
  return {
    ...(choices?.efforts.some(({ id }) => id === choice.effort) && {
      effort: choice.effort,
    }),
    ...(choice.fast && choices?.fast && !choices.fast.off && { fast: true }),
  };
}

/** The provider options that ask for a level exactly as its provider names it, and for Fast. */
export function choiceProviderOptions(
  providerId: string,
  { effort, fast }: ReturnType<typeof takenChoice>,
): SharedV2ProviderOptions {
  const family = providerId.split(".")[0] ?? "";
  const result: SharedV2ProviderOptions = {
    ...(effort && effortProviderOptions(family, effort)),
  };
  if (fast) {
    const asked = FAST_OPTIONS[family];
    if (asked) {
      result[family] = { ...result[family], ...asked };
    }
  }
  return result;
}

const FAST_OPTIONS: Record<string, Record<string, boolean | string>> = {
  anthropic: { speed: "fast" },
  "claude-account": { fast: true },
  openai: { serviceTier: "priority" },
};
