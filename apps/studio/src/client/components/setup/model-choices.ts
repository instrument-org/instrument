import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import {
  CHATGPT_ACCOUNT_PROVIDER_CONFIG,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
  GROK_ACCOUNT_PROVIDER_CONFIG,
  OUR_MODELS,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { boundedFuzzy } from "@/client/lib/bounded-fuzzy";
import { type ConnectProvider } from "@/shared/connect-outcome";

import { type LastConnection } from "./last-connection";

/**
 * What setup's model step lists, as data: the models worth picking for new
 * chats, the one it recommends, and how a long list groups. Pure, so the
 * lists are checked in node.
 */

/** Up to this many models fit Figma's short list (frame 04); more get the searchable box. */
const SHORT_LIST_MOST = 7;

/** The suggestions a long list opens on, the recommended one first. */
const SUGGESTED_MOST = 3;

/** A maker's name over its group, by the author slug catalogs use. */
const MAKER_NAMES: Record<string, string> = {
  amazon: "Amazon",
  anthropic: "Anthropic",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  "deepseek-ai": "DeepSeek",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  minimax: "MiniMax",
  mistralai: "Mistral",
  moonshotai: "Moonshot AI",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  perplexity: "Perplexity",
  qwen: "Qwen",
  "x-ai": "xAI",
  xai: "xAI",
  "z-ai": "Z.ai",
  "zai-org": "Z.ai",
};

export interface ModelGroup {
  label: string;
  models: AIGatewayModel.Type[];
}

/** Whose model it is: the maker behind one of ours, else its author. */
export function makerOf(model: AIGatewayModel.Type): string {
  return model.maker ?? model.author;
}

function makerName(slug: string): string {
  return MAKER_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * The models setup offers: none this person can't run, and none something
 * newer replaced, since a main model should be one to keep.
 */
export function choosableModels(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  return models.filter(
    (model) =>
      model.restricted === undefined &&
      model.replacedBy === undefined &&
      !model.tags.includes("legacy"),
  );
}

/** The config type each sign-in's connection has. */
const SIGN_IN_TYPES: Record<ConnectProvider, string> = {
  chatgpt: CHATGPT_ACCOUNT_PROVIDER_CONFIG.type,
  claude: CLAUDE_ACCOUNT_PROVIDER_CONFIG.type,
  grok: GROK_ACCOUNT_PROVIDER_CONFIG.type,
  instrument: OUR_PROVIDER_CONFIG.type,
};

/**
 * The models of the connection setup just made, or every connection's when
 * it connected none (the person came with their own) or its models haven't
 * listed yet.
 */
export function modelsOfConnection(
  models: AIGatewayModel.Type[],
  connection: LastConnection | undefined,
): AIGatewayModel.Type[] {
  if (connection === undefined) {
    return models;
  }
  const own = models.filter((model) =>
    connection.kind === "key"
      ? model.params.providerConfigId === connection.providerConfigId
      : model.params.provider === SIGN_IN_TYPES[connection.provider],
  );
  return own.length > 0 ? own : models;
}

/**
 * The one setup recommends: the default already set, which a sign-in set
 * to what suits it, when it is among them; otherwise the one the app would
 * have made the default (Auto, then one of ours, then a default-tagged
 * model, then a recommended one, then the first).
 */
export function recommendedModel(
  models: AIGatewayModel.Type[],
  defaultURI: string | undefined,
): AIGatewayModel.Type | undefined {
  const defaults = models.filter((model) => model.tags.includes("default"));
  return (
    models.find((model) => model.uri === defaultURI) ??
    defaults.find((model) => model.providerId === OUR_MODELS.text.id) ??
    defaults.find((model) => model.author === OUR_MODELS.author) ??
    defaults.find(
      (model) => model.params.provider === OUR_MODELS.providerType,
    ) ??
    defaults[0] ??
    models.find((model) => model.tags.includes("recommended")) ??
    models[0]
  );
}

export function isShortList(models: AIGatewayModel.Type[]): boolean {
  return models.length <= SHORT_LIST_MOST;
}

/** A short list, whole, the recommended model first and the rest as the catalog gives them. */
export function shortList(
  models: AIGatewayModel.Type[],
  recommended: AIGatewayModel.Type | undefined,
): AIGatewayModel.Type[] {
  return recommended
    ? [recommended, ...models.filter((model) => model !== recommended)]
    : models;
}

const fuzzy = boundedFuzzy({ intraMode: 1 });

/**
 * A long list's groups. With no search: Suggested (the recommended model,
 * then a few the catalogs recommend), then every other model under its
 * group. Under a search: every match, under its group, best first within
 * each. A group is the model's connection where the list has several, as
 * the picker buckets them, and its maker where one connection serves many
 * makers' models.
 */
export function longListGroups({
  models,
  query,
  recommended,
}: {
  models: AIGatewayModel.Type[];
  query: string;
  recommended: AIGatewayModel.Type | undefined;
}): ModelGroup[] {
  const byConnection =
    new Set(models.map((model) => model.params.providerConfigId)).size > 1;
  const grouped = (found: AIGatewayModel.Type[]) =>
    groupedBy(found, (model) =>
      byConnection ? model.providerName.trim() : makerName(makerOf(model)),
    );
  const needle = query.trim();
  if (needle !== "") {
    const names = models.map((model) => model.name.trim());
    const indexes = fuzzy.filter(names, needle);
    if (!indexes?.length) {
      return [];
    }
    const info = fuzzy.info(indexes, names, needle);
    const order = fuzzy.sort(info, names, needle);
    const found = order.flatMap((at) => {
      const model = models[info.idx[at] ?? -1];
      return model ? [model] : [];
    });
    return grouped(found);
  }
  const suggested = [
    ...(recommended ? [recommended] : []),
    ...models.filter(
      (model) => model !== recommended && model.tags.includes("recommended"),
    ),
  ].slice(0, SUGGESTED_MOST);
  const rest = models
    .filter((model) => !suggested.includes(model))
    .toSorted((a, b) =>
      a.name.trim().localeCompare(b.name.trim(), undefined, { numeric: true }),
    );
  return [
    ...(suggested.length > 0
      ? [{ label: "Suggested", models: suggested }]
      : []),
    ...grouped(rest),
  ];
}

/** Grouped under each label, labels in name order, models in the order given. */
function groupedBy(
  models: AIGatewayModel.Type[],
  labelOf: (model: AIGatewayModel.Type) => string,
): ModelGroup[] {
  const groups = new Map<string, AIGatewayModel.Type[]>();
  for (const model of models) {
    const label = labelOf(model);
    groups.set(label, [...(groups.get(label) ?? []), model]);
  }
  return [...groups]
    .map(([label, members]) => ({ label, models: members }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
