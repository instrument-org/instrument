import { type WorkspaceServerURL } from "@instrument-org/shared";
import { parseJsonEventStream } from "ai";
import { z } from "zod";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";

export interface ImageStreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type OpenRouterImageStreamEvent =
  | { base64: string; index: number; type: "partial" }
  | {
      base64: string;
      mediaType: string;
      type: "completed";
      usage?: ImageStreamUsage;
    }
  | { message: string; responseBody?: string; type: "error" };

const UsageSchema = z.object({
  completion_tokens: z.number().nullish(),
  prompt_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
});

// OpenRouter Images API SSE events. Anything that doesn't match (comments,
// `[DONE]`, other event types) fails validation and is skipped.
const ImageStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    b64_json: z.string(),
    partial_image_index: z.number().nullish(),
    type: z.literal("image_generation.partial_image"),
  }),
  z.object({
    b64_json: z.string(),
    media_type: z.string().nullish(),
    type: z.literal("image_generation.completed"),
    usage: UsageSchema.nullish(),
  }),
  z.object({
    error: z.object({ message: z.string().nullish() }).nullish(),
    type: z.literal("error"),
  }),
]);

// Streams OpenRouter's dedicated Images API (POST /api/v1/images with
// `stream: true`) through the same internal proxy the non-streaming AI SDK
// path uses, emitting progressive `partial_image` frames then the final
// `completed` frame. The provider SDK does not implement image streaming.
export async function* streamOpenRouterImage({
  config,
  count,
  modelId,
  parameters,
  prompt,
  signal,
  workspaceServerURL,
}: {
  config: AIGatewayProviderConfig.Type;
  count: number;
  modelId: string;
  parameters?: Record<string, boolean | number | string>;
  prompt: string;
  signal: AbortSignal;
  workspaceServerURL: WorkspaceServerURL;
}): AsyncGenerator<OpenRouterImageStreamEvent> {
  const url = `${internalURL({ config, workspaceServerURL })}/images`;

  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        model: modelId,
        n: count,
        prompt,
        stream: true,
        ...parameters,
      }),
      headers: {
        Authorization: `Bearer ${internalAPIKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
  } catch (error) {
    yield {
      message: error instanceof Error ? error.message : "Image stream failed",
      type: "error",
    };
    return;
  }

  if (!response.ok || !response.body) {
    let responseBody: string | undefined;
    try {
      responseBody = await response.text();
    } catch {
      // Ignore body read failures; the status is enough to surface the error.
    }
    yield {
      message: `Image stream failed: HTTP ${response.status}`,
      responseBody,
      type: "error",
    };
    return;
  }

  const events = parseJsonEventStream({
    schema: ImageStreamEventSchema,
    stream: response.body,
  }).getReader();

  // A stream that closes without ever producing an image (or an error) would
  // otherwise leave the tool without a terminal result. Partial-only streams
  // still yield their frames; the caller keeps the last partial.
  let sawFrame = false;
  let sawError = false;

  while (true) {
    const { done, value } = await events.read();
    if (done) {
      break;
    }
    if (!value.success) {
      continue;
    }
    const event = value.value;
    switch (event.type) {
      case "error": {
        sawError = true;
        yield {
          message: event.error?.message ?? "Image generation failed",
          type: "error",
        };
        break;
      }
      case "image_generation.completed": {
        sawFrame = true;
        yield {
          base64: event.b64_json,
          mediaType: event.media_type ?? "image/png",
          type: "completed",
          usage: toUsage(event.usage),
        };
        break;
      }
      case "image_generation.partial_image": {
        sawFrame = true;
        yield {
          base64: event.b64_json,
          index: event.partial_image_index ?? 0,
          type: "partial",
        };
        break;
      }
    }
  }

  if (!sawFrame && !sawError) {
    yield {
      message: "Image stream ended without producing an image",
      type: "error",
    };
  }
}

function toUsage(
  usage: null | undefined | z.output<typeof UsageSchema>,
): ImageStreamUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.prompt_tokens ?? undefined,
    outputTokens: usage.completion_tokens ?? undefined,
    totalTokens: usage.total_tokens ?? undefined,
  };
}
