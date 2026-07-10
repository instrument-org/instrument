import {
  type AIGatewayModel,
  type AIGatewayProviderConfig,
  type AISDKImageModelResult,
  getImageModel,
  type ImageGenerationProviderType,
  imageModelSupportsStreaming,
  resolveImageParameters,
  streamOpenRouterImage,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import {
  APICallError,
  generateImage,
  generateText,
  NoImageGeneratedError,
} from "ai";
import { err, ok, ResultAsync } from "neverthrow";

import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";

// Loose agent-supplied image parameters. Validated and routed per selected
// model by resolveImageParameters; unsupported knobs are dropped.
type ImageGenerationParameters = Record<string, boolean | number | string>;

interface ImageStreamChunk {
  // The parameters actually forwarded to the model, after dropping unsupported
  // ones -- what the UI should show as applied rather than merely requested.
  appliedParameters: ImageGenerationParameters;
  config: AIGatewayProviderConfig.Type;
  images: { base64: string; mediaType: string }[];
  kind: "final" | "partial";
  modelId: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

type ResolvedImageModel = AISDKImageModelResult & {
  config: AIGatewayProviderConfig.Type & { type: ImageGenerationProviderType };
};

function appliedParametersFrom({
  aspectRatio,
  providerParams,
}: {
  aspectRatio?: `${number}:${number}`;
  providerParams: ImageGenerationParameters;
}): ImageGenerationParameters {
  return aspectRatio ? { ...providerParams, aspectRatio } : { ...providerParams };
}

const SOURCE_IMAGE_LIMITS: Partial<
  Record<ImageGenerationProviderType, number>
> = {
  fireworks: 1,
  together: 1,
  "x-ai": 1,
};

// Buffered (non-streaming) generation from an already-resolved image model.
export async function generateBufferedImage({
  count,
  parameters,
  prompt,
  resolved,
  signal,
  sourceImages,
  workspaceConfig,
}: {
  count: number;
  parameters?: ImageGenerationParameters;
  prompt: string;
  resolved: ResolvedImageModel;
  signal: AbortSignal;
  sourceImages?: Buffer[];
  workspaceConfig: WorkspaceConfig;
}) {
  const { config, model, type } = resolved;

  if (sourceImages && sourceImages.length > 0) {
    const maxSourceImages = SOURCE_IMAGE_LIMITS[config.type];
    if (
      maxSourceImages !== undefined &&
      sourceImages.length > maxSourceImages
    ) {
      return err(
        new TypedError.ProviderLimitation(
          `The ${config.displayName ?? config.type} provider supports at most ${maxSourceImages} source image${maxSourceImages === 1 ? "" : "s"} per request, but ${sourceImages.length} were provided.`,
        ),
      );
    }
  }

  return ResultAsync.fromPromise(
    (async () => {
      if (type === "language") {
        const textResult =
          sourceImages && sourceImages.length > 0
            ? await generateText({
                abortSignal: signal,
                messages: [
                  {
                    content: [
                      ...sourceImages.map((buf) => ({
                        image: buf,
                        type: "image" as const,
                      })),
                      { text: prompt, type: "text" as const },
                    ],
                    role: "user" as const,
                  },
                ],
                model,
              })
            : await generateText({ abortSignal: signal, model, prompt });

        return {
          appliedParameters: {},
          config,
          images: textResult.files,
          modelId: model.modelId,
          usage: textResult.usage,
        };
      }

      // Validate agent params against the selected model's capabilities and
      // route them: aspectRatio as a standard AI SDK param, the rest under the
      // provider's own options key. Unsupported knobs are dropped.
      const { aspectRatio, namespace, providerParams } = resolveImageParameters(
        {
          parameters,
          providerType: config.type,
        },
      );
      const providerOptions =
        Object.keys(providerParams).length > 0
          ? { [namespace]: providerParams }
          : undefined;

      const imageResult = await generateImage({
        abortSignal: signal,
        aspectRatio,
        model,
        n: count,
        prompt:
          sourceImages && sourceImages.length > 0
            ? { images: sourceImages, text: prompt }
            : prompt,
        providerOptions,
      });

      return {
        appliedParameters: appliedParametersFrom({ aspectRatio, providerParams }),
        config,
        images: imageResult.images,
        modelId: model.modelId,
        usage: imageResult.usage,
      };
    })(),
    (generationError) => {
      const message = `Failed to generate image: ${generationError instanceof Error ? generationError.message : "Unknown error"}`;
      const responseBody = APICallError.isInstance(generationError)
        ? generationError.responseBody
        : undefined;
      const error = new TypedError.APICall(message, {
        cause: generationError,
        responseBody,
      });
      if (!NoImageGeneratedError.isInstance(generationError)) {
        workspaceConfig.captureException(error);
      }
      return error;
    },
  );
}

// Progressive generation used by the generate_image tool: resolves the image
// model once, then streams partial frames for our default model (text-to-image
// only) or yields a single buffered chunk for every other path.
export async function* generateImageStream(args: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  count: number;
  parameters?: ImageGenerationParameters;
  prompt: string;
  signal: AbortSignal;
  sourceImages?: Buffer[];
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const modelResult = await getImageModel({
    callingModel: args.callingModel,
    configs: args.configs,
    workspaceServerURL: args.workspaceServerURL,
  });
  const [resolved, modelError] = modelResult.toTuple();
  if (modelError) {
    yield err(modelError);
    return;
  }

  // Stream only our default model for text-to-image. A test-injected model has
  // no HTTP endpoint to stream from, so it takes the buffered path too.
  const canStream =
    imageModelSupportsStreaming(resolved.config.type) &&
    !(args.sourceImages && args.sourceImages.length > 0) &&
    resolved.config.type === OUR_MODELS.providerType &&
    !(TEST_IMAGE_MODEL_OVERRIDE_KEY in resolved.config);

  if (canStream) {
    yield* streamViaOpenRouter({ ...args, config: resolved.config });
    return;
  }

  const result = await generateBufferedImage({
    count: args.count,
    parameters: args.parameters,
    prompt: args.prompt,
    resolved,
    signal: args.signal,
    sourceImages: args.sourceImages,
    workspaceConfig: args.workspaceConfig,
  });
  if (result.isErr()) {
    yield err(result.error);
    return;
  }
  const value = result.value;
  yield ok<ImageStreamChunk>({
    appliedParameters: value.appliedParameters,
    config: value.config,
    images: value.images.map((file) => ({
      base64: file.base64,
      mediaType: file.mediaType,
    })),
    kind: "final",
    modelId: value.modelId,
    usage: {
      inputTokens: value.usage.inputTokens,
      outputTokens: value.usage.outputTokens,
      totalTokens: value.usage.totalTokens,
    },
  });
}

async function* streamViaOpenRouter(args: {
  config: AIGatewayProviderConfig.Type & { type: ImageGenerationProviderType };
  count: number;
  parameters?: ImageGenerationParameters;
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const modelId = OUR_MODELS.image.id;
  // The streaming body sends provider-option knobs (quality/background) as
  // top-level fields, which is what OpenRouter's images API expects.
  const { aspectRatio, providerParams } = resolveImageParameters({
    parameters: args.parameters,
    providerType: args.config.type,
  });
  const appliedParameters = appliedParametersFrom({ aspectRatio, providerParams });
  const fail = (message: string, responseBody?: string) => {
    const error = new TypedError.APICall(message, { responseBody });
    args.workspaceConfig.captureException(error);
    return err(error);
  };

  try {
    for await (const event of streamOpenRouterImage({
      config: args.config,
      count: args.count,
      modelId,
      parameters: providerParams,
      prompt: args.prompt,
      signal: args.signal,
      workspaceServerURL: args.workspaceServerURL,
    })) {
      if (event.type === "error") {
        yield fail(event.message, event.responseBody);
        return;
      }
      yield ok<ImageStreamChunk>({
        appliedParameters,
        config: args.config,
        images: [
          {
            base64: event.base64,
            mediaType:
              event.type === "completed" ? event.mediaType : "image/png",
          },
        ],
        kind: event.type === "completed" ? "final" : "partial",
        modelId,
        usage: event.type === "completed" ? event.usage : undefined,
      });
    }
  } catch (error) {
    yield fail(error instanceof Error ? error.message : "Image stream failed");
  }
}
