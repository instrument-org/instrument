import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
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

import { captureServerException } from "./capture-server-exception";
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
    captureException: captureServerException,
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
 * makes the model Claude Code recommends the default. Answers with the
 * model's name, so the connection can say what changed.
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
    captureException: captureServerException,
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

export async function setDefaultModel(options?: {
  onlyIfOurModel?: boolean;
  onlyIfUnset?: boolean;
}): Promise<void> {
  const existingDefault = getDefaultModelURI();
  if (existingDefault && options?.onlyIfUnset) {
    return;
  }

  if (existingDefault && options?.onlyIfOurModel) {
    const parsed = AIGatewayModelURI.parse(existingDefault);
    if (!parsed.ok || parsed.value.author !== OUR_MODELS.author) {
      return;
    }
  }

  const providers = getAIProviderConfigs();

  if (providers.length === 0) {
    return;
  }

  const modelsForProviders = await fetchModelResultsForProviders(providers, {
    captureException: captureServerException,
    modelCache: diskModelCache,
  });

  const models: AIGatewayModel.Type[] = [];
  for (const modelResults of modelsForProviders) {
    if (modelResults.ok) {
      models.push(...modelResults.value);
    }
  }

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
  const selectedModel = options?.onlyIfOurModel
    ? defaultModels.find((m) => m.author !== OUR_MODELS.author)
    : (defaultModels.find((m) => m.providerId === OUR_MODELS.text.id) ??
      defaultModels.find((m) => m.author === OUR_MODELS.author) ??
      defaultModels.find(
        (m) => m.params.provider === OUR_MODELS.providerType,
      ) ??
      defaultModels[0] ??
      recommendedModel ??
      models[0]);

  if (selectedModel) {
    setDefaultModelURI(selectedModel.uri);
  }
}
