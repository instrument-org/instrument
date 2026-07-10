import { type WorkspaceServerURL } from "@instrument-org/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import {
  type OpenRouterImageStreamEvent,
  streamOpenRouterImage,
} from "./stream-image";

async function collect() {
  const events: OpenRouterImageStreamEvent[] = [];
  for await (const event of streamOpenRouterImage({
    config: { id: "cfg-1" } as AIGatewayProviderConfig.Type,
    count: 1,
    modelId: "instrument/auto-image-2",
    prompt: "a cat",
    signal: new AbortController().signal,
    workspaceServerURL: "http://localhost" as WorkspaceServerURL,
  })) {
    events.push(event);
  }
  return events;
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

describe("streamOpenRouterImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps partial and completed frames and ignores [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          {
            b64_json: "data",
            partial_image_index: 0,
            type: "image_generation.partial_image",
          },
          {
            b64_json: "done",
            media_type: "image/png",
            type: "image_generation.completed",
            usage: {
              completion_tokens: 4,
              prompt_tokens: 3,
              total_tokens: 7,
            },
          },
        ]),
      ),
    );

    expect(await collect()).toEqual([
      { base64: "data", index: 0, type: "partial" },
      {
        base64: "done",
        mediaType: "image/png",
        type: "completed",
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      },
    ]);
  });

  it("surfaces an error frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([{ error: { message: "bad prompt" }, type: "error" }]),
        ),
    );

    expect(await collect()).toEqual([{ message: "bad prompt", type: "error" }]);
  });

  it("yields an error when the stream ends without producing an image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([])));

    expect(await collect()).toEqual([
      {
        message: "Image stream ended without producing an image",
        type: "error",
      },
    ]);
  });

  it("keeps partial frames when the stream ends without completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          {
            b64_json: "data",
            partial_image_index: 0,
            type: "image_generation.partial_image",
          },
        ]),
      ),
    );

    expect(await collect()).toEqual([
      { base64: "data", index: 0, type: "partial" },
    ]);
  });

  it("yields an error event on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );

    const events = await collect();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
  });
});
