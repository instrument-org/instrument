import { type ImageModelV4, type LanguageModelV4 } from "@ai-sdk/provider";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { Result } from "typescript-result";

import { type AIGatewayModel } from "../schemas/model";
import {
  type AIGatewayProviderConfig,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
} from "../schemas/provider-config";
import {
  createDeepInfraSDK,
  createFireworksSDK,
  createGoogleSDK,
  createOpenAISDK,
  createOpenRouterSDK,
  createTogetherAISDK,
  createVercelSDK,
  createXAISDK,
} from "./ai-sdk-for-provider-config";
import { TypedError } from "./errors";
import {
  describeImageParameters,
  imageCapabilitiesForProvider,
} from "./image-capabilities";
import {
  filterImageGenerationConfigs,
  type ImageGenerationProviderType,
} from "./providers/metadata";

/**
 * The person's own image providers, in the order a chat falls back on them
 * when its own provider makes no images: ordered by quality as of
 * 2026-01-30. Instrument's comes after every one of them.
 */
const OWN_PROVIDER_TYPE_PRIORITY: ImageGenerationProviderType[] = [
  "openrouter",
  "google",
  "openai",
  "x-ai",
  "grok-account",
  "vercel",
  "fireworks",
  "together",
  "deepinfra",
];

const GEMINI_IMAGE_MODEL_ID = "gemini-3.1-flash-lite-image";
const OPENROUTER_GEMINI_IMAGE_MODEL_ID = `google/${GEMINI_IMAGE_MODEL_ID}`;

export type AISDKImageModelResult =
  | { model: ImageModelV4; type: "image" }
  | { model: LanguageModelV4; type: "language" };

type ImageProviderConfig = AIGatewayProviderConfig.Type & {
  type: ImageGenerationProviderType;
};

/** The image model one provider config makes images with, ready to call. */
export async function getImageModelFor({
  config,
  workspaceServerURL,
}: {
  config: ImageProviderConfig;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const result = await getAISDKImageModel({ config, workspaceServerURL });
  return result.map((model) => ({ ...model, config }));
}

// Human-readable description of the parameters the selected image model
// supports, for the agent's system information. Falls back to "no
// parameters" when no image provider resolves, or before the chat has a
// model to pick one for. A model URI is enough to ask.
export function imageParametersDescription({
  callingModel,
  configs,
}: {
  callingModel: CallingModel;
  configs: AIGatewayProviderConfig.Type[];
}): string {
  const [selected] = callingModel.params.providerConfigId
    ? selectImageProviderConfigs({ callingModel, configs })
    : [];
  return describeImageParameters(
    selected
      ? imageCapabilitiesForProvider(selected.type)
      : { params: {}, supportsStreaming: false },
  );
}

/**
 * The image providers a chat's image request tries, in order: the chat's own
 * provider when it makes images, then
 * the person's own image providers, then Instrument's. So a free account's
 * images are only ever what a chat falls back on, and someone with their own
 * OpenRouter or Google key keeps making images with it.
 *
 * Never a second ChatGPT or Grok account: falling over from one plan to
 * another is the account rotation OpenAI's Sign in with ChatGPT Terms forbid,
 * and a subscription's limits are no less its own on xAI.
 *
 * Builds no SDK, so the tool description and the request agree on the
 * provider without a network call. Empty when nothing connected makes images.
 */
export function selectImageProviderConfigs({
  callingModel,
  configs,
}: {
  callingModel: CallingModel;
  configs: AIGatewayProviderConfig.Type[];
}): ImageProviderConfig[] {
  const imageConfigs = filterImageGenerationConfigs(configs);
  const chats = imageConfigs.find(
    (c) => c.id === callingModel.params.providerConfigId,
  );
  const ordered: ImageProviderConfig[] = chats ? [chats] : [];
  for (const type of OWN_PROVIDER_TYPE_PRIORITY) {
    const config = imageConfigs.find((c) => c.type === type);
    // One of each kind, so never a second plan of the chat's own kind.
    if (config && !ordered.some((c) => c.type === type)) {
      ordered.push(config);
    }
  }
  const ours = imageConfigs.find((c) => c.type === OUR_MODELS.providerType);
  if (ours && !ordered.includes(ours)) {
    ordered.push(ours);
  }
  return ordered;
}

/**
 * What of the calling model picks its image provider: its provider config,
 * where there is a model to ask about.
 */
type CallingModel = {
  params: {
    providerConfigId:
      | AIGatewayModel.Type["params"]["providerConfigId"]
      | undefined;
  };
};

async function getAISDKImageModel({
  config,
  workspaceServerURL,
}: {
  config: ImageProviderConfig;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const testOverride = (
    config as { [TEST_IMAGE_MODEL_OVERRIDE_KEY]?: AISDKImageModelResult }
  )[TEST_IMAGE_MODEL_OVERRIDE_KEY];
  if (testOverride) {
    return Result.ok(testOverride);
  }

  switch (config.type) {
    case "deepinfra": {
      const sdk = await createDeepInfraSDK(config, workspaceServerURL);
      const model = sdk.image("black-forest-labs/FLUX-1-schnell");
      return Result.ok({ model, type: "image" as const });
    }
    case "fireworks": {
      const sdk = await createFireworksSDK(config, workspaceServerURL);
      const model = sdk.imageModel(
        "accounts/fireworks/models/flux-1-schnell-fp8",
      );
      return Result.ok({ model, type: "image" as const });
    }
    case "google": {
      const sdk = await createGoogleSDK(config, workspaceServerURL);
      const model = sdk.imageModel(GEMINI_IMAGE_MODEL_ID);
      return Result.ok({ model, type: "image" as const });
    }
    case "openai": {
      const sdk = await createOpenAISDK(config, workspaceServerURL);
      const model = sdk.image("gpt-image-2.5-flare");
      return Result.ok({ model, type: "image" as const });
    }
    case "openrouter": {
      const sdk = await createOpenRouterSDK(config, workspaceServerURL);
      const model = sdk.imageModel(OPENROUTER_GEMINI_IMAGE_MODEL_ID);
      return Result.ok({ model, type: "image" as const });
    }
    case OUR_MODELS.providerType: {
      const sdk = await createOpenRouterSDK(config, workspaceServerURL);
      const model = sdk.imageModel(OUR_MODELS.image.id);
      return Result.ok({ model, type: "image" as const });
    }
    case "together": {
      const sdk = await createTogetherAISDK(config, workspaceServerURL);
      const model = sdk.image("black-forest-labs/FLUX.1-schnell");
      return Result.ok({ model, type: "image" as const });
    }
    case "vercel": {
      const sdk = createVercelSDK(config, workspaceServerURL);
      const model = sdk(OPENROUTER_GEMINI_IMAGE_MODEL_ID);
      return Result.ok({ model, type: "language" as const });
    }
    case "grok-account":
    case "x-ai": {
      const sdk = await createXAISDK(config, workspaceServerURL);
      const model = sdk.imageModel("grok-imagine-image");
      return Result.ok({ model, type: "image" as const });
    }
    default: {
      const _exhaustiveCheck: never = config.type;
      return Result.error(
        new TypedError.NotFound(
          `Unhandled provider type: ${JSON.stringify(_exhaustiveCheck)}`,
        ),
      );
    }
  }
}
