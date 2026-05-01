import type {
  LanguageModelV3Content,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

import { OUR_MODELS } from "@instrument-org/shared";

import { type AIGatewayModel } from "../schemas/model";
import { decodeHtmlEntities } from "./decode-html-entities";

export function shouldApplyXaiGrokHtmlEntityMiddleware(
  model: AIGatewayModel.Type,
) {
  // Direct xAI grok models
  if (model.author === "x-ai" && model.canonicalId.startsWith("grok-")) {
    return true;
  }
  // Instrument auto model can use xAI grok models
  if (model.params.provider === OUR_MODELS.providerType) {
    return true;
  }
  return false;
}

function mapGenerateContent(part: LanguageModelV3Content) {
  switch (part.type) {
    case "reasoning":
    case "text": {
      return { ...part, text: decodeHtmlEntities(part.text) };
    }
    case "tool-call": {
      return { ...part, input: decodeHtmlEntities(part.input) };
    }
    default: {
      return part;
    }
  }
}

function mapStreamChunk(chunk: LanguageModelV3StreamPart) {
  switch (chunk.type) {
    case "reasoning-delta":
    case "text-delta":
    case "tool-input-delta": {
      return { ...chunk, delta: decodeHtmlEntities(chunk.delta) };
    }
    case "tool-call": {
      return { ...chunk, input: decodeHtmlEntities(chunk.input) };
    }
    default: {
      return chunk;
    }
  }
}

export const xaiGrokHtmlEntityLanguageModelMiddleware = {
  specificationVersion: "v3",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    return {
      ...result,
      content: result.content.map(mapGenerateContent),
    };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream<
          LanguageModelV3StreamPart,
          LanguageModelV3StreamPart
        >({
          transform(chunk, controller) {
            controller.enqueue(mapStreamChunk(chunk));
          },
        }),
      ),
    };
  },
} satisfies LanguageModelV3Middleware;
