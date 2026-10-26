import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import { getDisabledProviderConfigIds } from "@/electron-main/stores/workspace/provider-configs";
import {
  getDefaultModelURI,
  setDefaultModelURI,
} from "@/electron-main/stores/workspace/preferences";
import {
  type AIGatewayModel,
  AIGatewayModelURI,
  chatGPTAccountDefaultModel,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";

import { captureFor } from "./capture-server-exception";
import { getAIProviderConfigs } from "./get-ai-provider-configs";

/**
 * Signing in with ChatGPT is asked for to use the plan, so it makes the plan's
 * everyday model the default; `chatGPTAccountDefaultModel` says which. Only for
 * the first account: adding another leaves the default where it was. Answers
 * with the model's name, so the sign-in can say what changed.
 */
export async function setChatGPTAccountDefaultModel({
  accountId,
}: {
  accountId: string;
}): Promise<string | undefined> {
  const chatGPTConfigs = getAIProviderConfigs().filter(
    (candidate) => candidate.type === "chatgpt-account",
  );
  const [config] = chatGPTConfigs;
  if (chatGPTConfigs.length !== 1 || config?.id !== accountId) {
    return undefined;
  }
  const [result] = await fetchModelResultsForProviders([config], {
    captureException: captureFor("ai-gateway"),
    modelCache: diskModelCache,
  });
  const chosen = result?.ok
    ? chatGPTAccountDefaultModel(result.value)
    : undefined;
  if (!chosen) {
    return undefined;
  }
  setDefaultModelURI(chosen.uri);
  return chosen.name.trim();
}

/**
 * Connecting a Claude account is asked for to use the subscription, so it
 * makes the account's default-tagged model (the newest Sonnet) the default.
 * Answers with the model's name, so the connection can say what changed.
 */
export async function setClaudeAccountDefaultModel(): Promise<
  string | undefined
> {
  const config = getAIProviderConfigs().find(
    (candidate) => candidate.type === "claude-account",
  );
  if (!config) {
    return undefined;
  }
  const [result] = await fetchModelResultsForProviders([config], {
    captureException: captureFor("ai-gateway"),
    modelCache: diskModelCache,
  });
  const models = result?.ok ? result.value : [];
  const chosen =
    models.find((model) => model.tags.includes("default")) ?? models[0];
  if (!chosen) {
    return undefined;
  }
  setDefaultModelURI(chosen.uri);
  return chosen.name.trim();
}

/**
 * Signing in with Grok is asked for to use the subscription, so it makes the
 * account's default-tagged model the default. Only for the first account:
 * adding another leaves the default where it was.
 */
export async function setGrokAccountDefaultModel({
  accountId,
}: {
  accountId: string;
}): Promise<string | undefined> {
  const grokConfigs = getAIProviderConfigs().filter(
    (candidate) => candidate.type === "grok-account",
  );
  const [config] = grokConfigs;
  if (grokConfigs.length !== 1 || config?.id !== accountId) {
    return undefined;
  }
  const [result] = await fetchModelResultsForProviders([config], {
    captureException: captureFor("ai-gateway"),
    modelCache: diskModelCache,
  });
  const chosen = result?.ok
    ? result.value.find((model) => model.tags.includes("default"))
    : undefined;
  if (!chosen) {
    return undefined;
  }
  setDefaultModelURI(chosen.uri);
  return chosen.name.trim();
}

/**
 * Picks a default model from what the connections list. `replacing` says
 * which default already set it may replace: any, only one of ours, or none.
 * With no default set, it always picks one.
 */
export async function setDefaultModel({
  replacing,
}: {
  replacing: "anything" | "nothing" | "ours";
}): Promise<void> {
  const existingDefault = getDefaultModelURI();
  if (existingDefault && replacing === "nothing") {
    return;
  }

  if (existingDefault && replacing === "ours") {
    const parsed = AIGatewayModelURI.parse(existingDefault);
    if (!parsed.ok || parsed.value.author !== OUR_MODELS.author) {
      return;
    }
  }

  const selectedModel = pickDefaultModel(await listModels(), {
    replacingOurs: replacing === "ours",
  });

  if (selectedModel) {
    setDefaultModelURI(selectedModel.uri);
  }
}

/**
 * The default new chats use: the one chosen, unless the connection it was
 * chosen through is turned off, when it is the model `setDefaultModel` would
 * pick from what is still on. The choice itself is kept, so turning the
 * connection back on brings it back.
 */
export async function effectiveDefaultModelURI(): Promise<
  AIGatewayModelURI.Type | undefined
> {
  const chosen = getDefaultModelURI();
  const parsed = chosen && AIGatewayModelURI.parse(chosen);
  if (
    !parsed ||
    !parsed.ok ||
    !getDisabledProviderConfigIds().has(parsed.value.params.providerConfigId)
  ) {
    return chosen;
  }
  return pickDefaultModel(await listModels())?.uri;
}

/** Every model the connections that are on list, skipping any that failed. */
async function listModels(): Promise<AIGatewayModel.Type[]> {
  const providers = getAIProviderConfigs();
  if (providers.length === 0) {
    return [];
  }
  const modelsForProviders = await fetchModelResultsForProviders(providers, {
    captureException: captureFor("ai-gateway"),
    modelCache: diskModelCache,
  });
  return modelsForProviders.flatMap((result) =>
    result.ok ? result.value : [],
  );
}

function pickDefaultModel(
  models: AIGatewayModel.Type[],
  { replacingOurs = false } = {},
): AIGatewayModel.Type | undefined {
  const defaultModels = models.filter((model) =>
    model.tags.includes("default"),
  );

  const recommendedModel = models.find((model) =>
    model.tags.includes("recommended"),
  );

  // When replacing one of our models, select our default model
  // Otherwise:
  // 1. Our auto model
  // 2. Our authored model (ours/*)
  // 3. Our provider model (any/model?provider=ours)
  // 4. First default model
  // 5. First recommended model
  // 6. First available model
  return replacingOurs
    ? defaultModels.find((m) => m.author !== OUR_MODELS.author)
    : (defaultModels.find((m) => m.providerId === OUR_MODELS.text.id) ??
        defaultModels.find((m) => m.author === OUR_MODELS.author) ??
        defaultModels.find(
          (m) => m.params.provider === OUR_MODELS.providerType,
        ) ??
        defaultModels[0] ??
        recommendedModel ??
        models[0]);
}
