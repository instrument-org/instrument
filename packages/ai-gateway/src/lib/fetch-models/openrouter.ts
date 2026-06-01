import { Result } from "typescript-result";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { fetchOpenAICompatibleModels } from "./openai-compatible";
import { parseOpenRouterModelsList } from "./parse-openrouter-models";

export function fetchModelsForOpenRouter(config: AIGatewayProviderConfig.Type) {
  return Result.gen(function* () {
    const data = yield* fetchOpenAICompatibleModels(config);

    return yield* parseOpenRouterModelsList({
      config,
      data,
    });
  });
}
