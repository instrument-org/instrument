import {
  getDefaultModelURI,
  setDefaultModelURI,
} from "@/electron-main/stores/preferences";
import {
  type AIGatewayModel,
  AIGatewayModelURI,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";

import { captureServerException } from "./capture-server-exception";
import { getAIProviderConfigs } from "./get-ai-provider-configs";

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

  // When replacing one of our models, select our default model
  // Otherwise:
  // 1. Our auto model
  // 2. Our authored model (ours/*)
  // 3. Our provider model (any/model?provider=ours)
  // 4. First default model
  const selectedModel = options?.onlyIfOurModel
    ? defaultModels.find((m) => m.author !== OUR_MODELS.author)
    : (defaultModels.find((m) => m.providerId === OUR_MODELS.text.id) ??
      defaultModels.find((m) => m.author === OUR_MODELS.author) ??
      defaultModels.find(
        (m) => m.params.provider === OUR_MODELS.providerType,
      ) ??
      defaultModels[0]);

  if (selectedModel) {
    setDefaultModelURI(selectedModel.uri);
  }
}
