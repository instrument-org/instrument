import { AIGatewayModel } from "@instrument-org/ai-gateway/schemas";
import { CLAUDE_ACCOUNT_PROVIDER_CONFIG } from "@instrument-org/shared";
import { call, os } from "@orpc/server";
import { beforeEach, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { gateway } from "./gateway";

const mocks = vi.hoisted(() => ({
  claudeStatusKnown: vi.fn(),
  refreshChatGPT: vi.fn(),
  fetchModels: vi.fn(),
}));

vi.mock("@/electron-main/rpc/base", () => ({ base: os }));
vi.mock("@/electron-main/lib/claude-account", () => ({
  claudeAccountStatusKnown: mocks.claudeStatusKnown,
}));
vi.mock("@/electron-main/lib/chatgpt-account", () => ({
  refreshExpiredTokens: mocks.refreshChatGPT,
}));
vi.mock("@instrument-org/ai-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@instrument-org/ai-gateway")>()),
  fetchModelResultsForProviders: mocks.fetchModels,
}));

const cachedModel = AIGatewayModel.Schema.parse({
  author: "anthropic",
  canonicalId: "claude-sonnet-4.6",
  features: [],
  name: "Claude Sonnet 4.6",
  params: { provider: "claude-account", providerConfigId: "claude-account" },
  providerId: "claude-sonnet-4-6",
  providerName: "Claude",
  tags: [],
  uri: "anthropic/claude-sonnet-4.6?provider=claude-account&providerConfigId=claude-account",
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.refreshChatGPT.mockResolvedValue(undefined);
  mocks.fetchModels.mockResolvedValue([]);
});

it.each(["cached", "fresh"])(
  "waits for Claude discovery before reading providers for the %s list",
  async (source) => {
    let finishDiscovery = () => {};
    const discovery = new Promise<void>((resolve) => {
      finishDiscovery = resolve;
    });
    mocks.claudeStatusKnown.mockReturnValue(discovery);
    const getAIProviderConfigs = vi.fn(() => [CLAUDE_ACCOUNT_PROVIDER_CONFIG]);
    const readCache = vi.fn(() => [cachedModel]);
    // The route only reads these context fields; the other app services are unused.
    const context = {
      workspaceConfig: {
        getAIProviderConfigs,
        captureException: vi.fn(),
        modelCache: { read: readCache, write: vi.fn() },
      },
    } as unknown as InitialRPCContext;
    const signal = new AbortController().signal;
    const stream =
      source === "cached"
        ? await call(gateway.models.live.list, {}, { context, signal })
        : undefined;
    const pending = stream
      ? stream.next()
      : call(gateway.models.list, {}, { context, signal });

    await vi.waitFor(() => expect(mocks.claudeStatusKnown).toHaveBeenCalled());
    expect(getAIProviderConfigs).not.toHaveBeenCalled();
    expect(readCache).not.toHaveBeenCalled();
    expect(mocks.fetchModels).not.toHaveBeenCalled();

    finishDiscovery();
    const result = await pending;
    expect(getAIProviderConfigs).toHaveBeenCalled();
    if (stream) {
      expect(result).toEqual({
        done: false,
        value: { errors: [], models: [cachedModel] },
      });
      await stream.return?.();
    } else {
      expect(mocks.refreshChatGPT).toHaveBeenCalled();
      expect(mocks.fetchModels).toHaveBeenCalledWith(
        [CLAUDE_ACCOUNT_PROVIDER_CONFIG],
        expect.anything(),
      );
    }
  },
);
