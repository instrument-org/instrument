import {
  getImageModel,
  streamOpenRouterImage,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";
import { generateImage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceConfig } from "../types";
import { generateBufferedImage, generateImageStream } from "./generate-images";

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImageModel: vi.fn(),
  streamOpenRouterImage: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateImage: vi.fn(),
}));

const workspaceConfig = {
  captureException: vi.fn(),
} as unknown as WorkspaceConfig;

function callBuffered(
  configType: string,
  parameters?: Record<string, boolean | number | string>,
) {
  vi.mocked(generateImage).mockResolvedValue({
    images: [{ base64: "aGk=", mediaType: "image/png" }],
    // Always an array from the real call, one entry per request it made.
    responses: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  } as unknown as Awaited<ReturnType<typeof generateImage>>);
  return generateBufferedImage({
    count: 1,
    parameters,
    prompt: "a cat",
    resolved: {
      config: { displayName: "Test", id: "cfg-1", type: configType },
      model: { modelId: "test-model" },
      type: "image",
    } as unknown as Parameters<typeof generateBufferedImage>[0]["resolved"],
    signal: new AbortController().signal,
    workspaceConfig,
  });
}

function lastAspectRatio() {
  const call = vi.mocked(generateImage).mock.calls.at(-1);
  return call?.[0].aspectRatio;
}

function lastProviderOptions() {
  const call = vi.mocked(generateImage).mock.calls.at(-1);
  return call?.[0].providerOptions;
}

function mockImageModel(configType: string) {
  // generateImageStream consumes `.toTuple()` from the resolved result.
  vi.mocked(getImageModel).mockResolvedValue({
    toTuple: () => [
      {
        config: { displayName: "Test", id: "cfg-1", type: configType },
        model: { modelId: "test-model" },
        type: "image",
      },
      undefined,
    ],
  } as unknown as Awaited<ReturnType<typeof getImageModel>>);
  vi.mocked(generateImage).mockResolvedValue({
    images: [{ base64: "aGk=", mediaType: "image/png" }],
    // Always an array from the real call, one entry per request it made.
    responses: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  } as unknown as Awaited<ReturnType<typeof generateImage>>);
}

describe("generateBufferedImage parameter mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes quality/background under the provider option key for the default model", async () => {
    const result = await callBuffered(OUR_MODELS.providerType, {
      background: "opaque",
      quality: "high",
    });

    expect(result.isOk()).toBe(true);
    expect(lastProviderOptions()).toEqual({
      openrouter: { background: "opaque", quality: "high" },
    });
    expect(lastAspectRatio()).toBeUndefined();
  });

  it("routes quality under the openai key for an openai provider config", async () => {
    await callBuffered("openai", { quality: "high" });

    expect(lastProviderOptions()).toEqual({ openai: { quality: "high" } });
  });

  it("passes aspectRatio as a standard param for models that support it", async () => {
    await callBuffered("openrouter", { aspectRatio: "16:9" });

    expect(lastAspectRatio()).toBe("16:9");
    expect(lastProviderOptions()).toBeUndefined();
  });

  it("drops parameters the selected model does not support", async () => {
    // gpt-image-2 (default) has no aspect ratio; gemini-via-openrouter has no quality.
    await callBuffered(OUR_MODELS.providerType, { aspectRatio: "16:9" });
    expect(lastAspectRatio()).toBeUndefined();
    expect(lastProviderOptions()).toBeUndefined();

    await callBuffered("openrouter", { quality: "high" });
    expect(lastProviderOptions()).toBeUndefined();
  });

  it("drops values outside the model's allowed set", async () => {
    // Google's Gemini image config allows fewer ratios than OpenRouter's.
    await callBuffered("google", { aspectRatio: "21:9" });
    expect(lastAspectRatio()).toBeUndefined();

    await callBuffered("google", { aspectRatio: "16:9" });
    expect(lastAspectRatio()).toBe("16:9");
  });

  it("omits providerOptions and aspectRatio when no parameters are given", async () => {
    await callBuffered(OUR_MODELS.providerType);

    expect(lastProviderOptions()).toBeUndefined();
    expect(lastAspectRatio()).toBeUndefined();
  });
});

async function collectStream() {
  const chunks = [];
  for await (const chunk of generateImageStream({
    callingModel: {} as never,
    configs: [] as never,
    count: 1,
    prompt: "a cat",
    signal: new AbortController().signal,
    workspaceConfig,
    workspaceServerURL: "http://localhost" as never,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("generateImageStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams partial then final frames for the instrument provider", async () => {
    mockImageModel(OUR_MODELS.providerType);
    vi.mocked(streamOpenRouterImage).mockImplementation(function* () {
      yield { base64: "data", index: 0, type: "partial" };
      yield {
        base64: "done",
        mediaType: "image/png",
        type: "completed",
        usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
      };
    } as never);

    const chunks = await collectStream();
    const values = chunks.map((chunk) => (chunk.isOk() ? chunk.value : null));

    expect(values.map((value) => value?.kind)).toEqual(["partial", "final"]);
    expect(values[0]?.images[0]?.base64).toBe("data");
    expect(values[1]?.usage).toEqual({
      inputTokens: 5,
      outputTokens: 6,
      totalTokens: 11,
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("defers to the buffered path when a test image override is present", async () => {
    vi.mocked(getImageModel).mockResolvedValue({
      toTuple: () => [
        {
          config: {
            id: "cfg-1",
            [TEST_IMAGE_MODEL_OVERRIDE_KEY]: {},
            type: OUR_MODELS.providerType,
          },
          model: { modelId: "mock-image-model" },
          type: "image",
        },
        undefined,
      ],
    } as unknown as Awaited<ReturnType<typeof getImageModel>>);
    vi.mocked(generateImage).mockResolvedValue({
      images: [{ base64: "file", mediaType: "image/png" }],
      responses: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as unknown as Awaited<ReturnType<typeof generateImage>>);

    const chunks = await collectStream();

    expect(
      chunks.map((chunk) => (chunk.isOk() ? chunk.value.kind : "err")),
    ).toEqual(["final"]);
    expect(streamOpenRouterImage).not.toHaveBeenCalled();
    expect(generateImage).toHaveBeenCalled();
  });

  it("surfaces a stream error as a failed result", async () => {
    mockImageModel(OUR_MODELS.providerType);
    vi.mocked(streamOpenRouterImage).mockImplementation(function* () {
      yield { message: "boom", type: "error" };
    } as never);

    const chunks = await collectStream();

    expect(chunks.at(-1)?.isErr()).toBe(true);
  });
});
