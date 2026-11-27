import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { call, os } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { providerConfig } from "./provider-config";

const mocks = vi.hoisted(() => ({
  configs: [] as AIGatewayProviderConfig.Type[],
  grokPlanSwitchedOnHere: vi.fn(() => Promise.resolve()),
  setProviderConfigEnabled: vi.fn(),
}));

vi.mock("@/electron-main/auth/server", () => ({
  startAuthCallbackServer: vi.fn(),
}));
vi.mock("@/electron-main/lib/openrouter-connect", () => ({
  cancelOpenRouterConnect: vi.fn(),
  connectOpenRouter: vi.fn(),
}));
vi.mock("@/electron-main/lib/set-default-model", () => ({
  setDefaultModel: vi.fn(),
}));
vi.mock("@/electron-main/lib/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));
vi.mock("@/electron-main/rpc/base", () => ({
  base: os.errors({ FETCH_FAILED: {}, NOT_FOUND: {}, VALIDATION_ERROR: {} }),
}));
vi.mock("@/electron-main/lib/get-ai-provider-configs", () => ({
  getAIProviderConfigs: () => mocks.configs,
  getAllAIProviderConfigs: () => mocks.configs,
}));
vi.mock("../../stores/workspace/provider-configs", () => ({
  getDisabledProviderConfigIds: () => new Set(),
  getProviderConfigsStore: vi.fn(),
  setProviderConfigEnabled: mocks.setProviderConfigEnabled,
}));
vi.mock(
  import("@instrument-org/workspace/electron"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    grokPlanSwitchedOnHere: mocks.grokPlanSwitchedOnHere,
  }),
);

// Nothing of the context is read on these paths.
const options = { context: {} as unknown as InitialRPCContext };

const config = (id: string, type: "grok-account" | "openai") => ({
  apiKey: "key",
  cacheIdentifier: id,
  id: AIProviderConfigIdSchema.parse(id),
  type,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configs = [config("g1", "grok-account"), config("k1", "openai")];
});

describe("providerConfig.setEnabled", () => {
  it("tells X a Grok plan is back once a Grok account is enabled", async () => {
    await call(
      providerConfig.setEnabled,
      { enabled: true, id: AIProviderConfigIdSchema.parse("g1") },
      options,
    );

    expect(mocks.setProviderConfigEnabled).toHaveBeenCalledWith("g1", true);
    expect(mocks.grokPlanSwitchedOnHere).toHaveBeenCalledOnce();
  });

  it("tells X nothing for another provider, or a Grok account disabled", async () => {
    await call(
      providerConfig.setEnabled,
      { enabled: true, id: AIProviderConfigIdSchema.parse("k1") },
      options,
    );
    await call(
      providerConfig.setEnabled,
      { enabled: false, id: AIProviderConfigIdSchema.parse("g1") },
      options,
    );

    expect(mocks.grokPlanSwitchedOnHere).not.toHaveBeenCalled();
  });
});
