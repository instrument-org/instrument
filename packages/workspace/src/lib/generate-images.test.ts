import {
  getImageModelFor,
  selectImageProviderConfigs,
  streamOpenRouterImage,
  TEST_IMAGE_MODEL_OVERRIDE_KEY,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";
import { APICallError, generateImage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { type WorkspaceConfig } from "../types";
import {
  generateBufferedImage,
  generateImageStream,
  ImageRefused,
  NoImageProvider,
} from "./generate-images";

vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getImageModelFor: vi.fn(),
  selectImageProviderConfigs: vi.fn(),
  streamOpenRouterImage: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateImage: vi.fn(),
}));

const workspaceConfig = {
  captureException: vi.fn(),
} as unknown as WorkspaceConfig;

const SESSION_ID = StoreId.newSessionId();

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
    sessionId: SESSION_ID,
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

/**
 * The chat's image providers, in the order they are tried, each set up as a
 * model; every buffered call answers with an image.
 */
function mockImageProviders(
  ...providers: (Record<string, unknown> & { type: string })[]
) {
  const configs = providers.map((provider, index) => ({
    displayName: "Test",
    id: `cfg-${index + 1}`,
    ...provider,
  }));
  vi.mocked(selectImageProviderConfigs).mockReturnValue(configs as never);
  vi.mocked(getImageModelFor).mockImplementation(({ config }) =>
    Promise.resolve({
      ok: true,
      value: { config, model: { modelId: "test-model" }, type: "image" },
    } as never),
  );
  vi.mocked(generateImage).mockResolvedValue({
    images: [{ base64: "aGk=", mediaType: "image/png" }],
    // Always an array from the real call, one entry per request it made.
    responses: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  } as unknown as Awaited<ReturnType<typeof generateImage>>);
}

function mockImageModel(configType: string) {
  mockImageProviders({ type: configType });
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
    // gpt-image-2.5-flare (default) has no aspect ratio; gemini-via-openrouter has no quality.
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

async function collectStream(
  signal = new AbortController().signal,
  sourceImages?: Buffer[],
) {
  const chunks = [];
  for await (const chunk of generateImageStream({
    callingModel: {} as never,
    chatId: ChatIdSchema.parse("images"),
    configs: [] as never,
    count: 1,
    prompt: "a cat",
    sessionId: SESSION_ID,
    signal,
    sourceImages,
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

  it("keeps the quality Instrument says an image was generated at", async () => {
    mockImageModel(OUR_MODELS.providerType);
    vi.mocked(streamOpenRouterImage).mockImplementation(function* () {
      yield {
        base64: "done",
        mediaType: "image/png",
        quality: "low",
        type: "completed",
      };
    } as never);

    const [only] = await collectStream();

    expect(only?.isOk() && only.value.quality).toBe("low");
  });

  it("takes the quality asked of a provider of the person's own", async () => {
    mockImageModel("openai");

    const chunks = [];
    for await (const chunk of generateImageStream({
      callingModel: {} as never,
      chatId: ChatIdSchema.parse("images"),
      configs: [] as never,
      count: 1,
      parameters: { quality: "high" },
      prompt: "a cat",
      sessionId: SESSION_ID,
      signal: new AbortController().signal,
      workspaceConfig,
      workspaceServerURL: "http://localhost" as never,
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.isOk() && chunks[0].value.quality).toBe("high");
  });

  it("defers to the buffered path when a test image override is present", async () => {
    mockImageProviders({
      [TEST_IMAGE_MODEL_OVERRIDE_KEY]: {},
      type: OUR_MODELS.providerType,
    });

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
    expect(workspaceConfig.captureException).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "throws",
      function* () {
        yield* [];
        throw new DOMException("This operation was aborted", "AbortError");
      },
    ],
    [
      "yields an error event",
      function* () {
        yield { message: "This operation was aborted", type: "error" };
      },
    ],
  ])(
    "ends without capturing when the stream %s after its own signal fires",
    async (_, stream) => {
      mockImageModel(OUR_MODELS.providerType);
      vi.mocked(streamOpenRouterImage).mockImplementation(stream as never);
      const controller = new AbortController();
      controller.abort();

      const chunks = await collectStream(controller.signal);

      expect(chunks.at(-1)?.isErr()).toBe(true);
      expect(workspaceConfig.captureException).not.toHaveBeenCalled();
    },
  );

  it("ends without capturing when the buffered call is stopped", async () => {
    mockImageModel("openai");
    vi.mocked(generateImage).mockRejectedValue(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const controller = new AbortController();
    controller.abort();

    const chunks = await collectStream(controller.signal);

    expect(chunks.at(-1)?.isErr()).toBe(true);
    expect(workspaceConfig.captureException).not.toHaveBeenCalled();
  });

  const spent = {
    code: "usage-limit-exceeded",
    resetsAt: "2026-10-23T09:12:00.000Z",
  } as const;

  it("moves on from Instrument's refusal to the person's own provider", async () => {
    mockImageProviders({ type: OUR_MODELS.providerType }, { type: "google" });
    vi.mocked(streamOpenRouterImage).mockImplementation(function* () {
      yield { refusal: spent, type: "refused" };
    } as never);

    const chunks = await collectStream();

    expect(
      chunks.map((chunk) => chunk.isOk() && chunk.value.config.id),
    ).toEqual(["cfg-2"]);
    expect(workspaceConfig.captureException).not.toHaveBeenCalled();
  });

  it("ends on an own provider's failure rather than spending Instrument's", async () => {
    mockImageProviders({ type: "google" }, { type: OUR_MODELS.providerType });
    vi.mocked(generateImage).mockRejectedValueOnce(new Error("quota"));

    const chunks = await collectStream();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.isErr() && chunks[0].error.type).toBe(
      "workspace-api-call-error",
    );
  });

  it("reads a refusal off Instrument's buffered path too", async () => {
    mockImageProviders({ type: OUR_MODELS.providerType });
    vi.mocked(generateImage).mockRejectedValueOnce(
      new APICallError({
        message: "Too Many Requests",
        requestBodyValues: {},
        responseBody: JSON.stringify({ error: spent }),
        statusCode: 429,
        url: "http://localhost/images",
      }),
    );

    // A source image keeps Instrument's image on the buffered path.
    const [only] = await collectStream(undefined, [Buffer.from("png")]);

    expect(only?.isErr() && only.error).toBeInstanceOf(ImageRefused);
    expect(workspaceConfig.captureException).not.toHaveBeenCalled();
  });

  it("says Instrument refused when it is the last provider to try", async () => {
    mockImageProviders({ type: OUR_MODELS.providerType });
    vi.mocked(streamOpenRouterImage).mockImplementation(function* () {
      yield { refusal: spent, type: "refused" };
    } as never);

    const [only] = await collectStream();

    expect(only?.isErr() && only.error).toBeInstanceOf(ImageRefused);
    expect(only?.isErr() && only.error).toMatchObject({ refusal: spent });
    expect(workspaceConfig.captureException).not.toHaveBeenCalled();
  });

  it("says nothing connected makes images when there is no provider", async () => {
    mockImageProviders();

    const [only] = await collectStream();

    expect(only?.isErr() && only.error).toBeInstanceOf(NoImageProvider);
  });
});
