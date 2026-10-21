import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkAccount, connectAccount } from "./account-check";

const mocks = vi.hoisted(() => ({
  checkAccountWithRequest: vi.fn(),
  checkGrokSubscriptions: vi.fn(),
  chatGPTAccounts: [] as { id: string; state: string }[],
  claudeStatus: vi.fn(),
  claudeUsage: vi.fn(),
  defaultModel: undefined as string | undefined,
  grokAccounts: [] as { id: string; plan?: string; state: string }[],
  models: vi.fn(),
  setChatGPT: vi.fn(),
  setClaude: vi.fn(),
  setGrok: vi.fn(),
}));

vi.mock("@/electron-main/stores/machine/model-cache", () => ({
  diskModelCache: {},
}));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  getDefaultModelURI: () => mocks.defaultModel,
}));
vi.mock("./capture-server-exception", () => ({ captureFor: () => vi.fn() }));
vi.mock("./get-ai-provider-configs", () => ({
  getAIProviderConfigs: () => [
    { id: "gpt-1", type: "chatgpt-account" },
    { id: "claude", type: "claude-account" },
  ],
}));
vi.mock("./chatgpt-account", () => ({
  chatGPTAccountPlan: () => "plus",
  chatGPTAccountsStatus: () => ({ accounts: mocks.chatGPTAccounts }),
  refreshExpiredTokens: () => Promise.resolve(),
}));
vi.mock("./claude-account", () => ({
  claudeAccountUsage: mocks.claudeUsage,
  refreshClaudeAccountStatus: mocks.claudeStatus,
}));
vi.mock("./grok-account", () => ({
  checkGrokSubscriptions: mocks.checkGrokSubscriptions,
  grokAccountsStatus: () => ({ accounts: mocks.grokAccounts }),
}));
vi.mock("./set-default-model", () => ({
  setChatGPTAccountDefaultModel: mocks.setChatGPT,
  setClaudeAccountDefaultModel: mocks.setClaude,
  setGrokAccountDefaultModel: mocks.setGrok,
}));
vi.mock("@instrument-org/ai-gateway", () => ({
  chatGPTAccountDefaultModel: (models: { uri: string }[]) => models[0],
  fetchModelResultsForProviders: mocks.models,
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  checkAccountWithRequest: mocks.checkAccountWithRequest,
}));

const never = () => new Promise<never>(() => {});

beforeEach(() => {
  mocks.chatGPTAccounts = [{ id: "gpt-1", state: "signed-in" }];
  mocks.grokAccounts = [];
  mocks.defaultModel = undefined;
  mocks.models.mockResolvedValue([
    { ok: true, value: [{ tags: ["default"], uri: "gpt/model" }] },
  ]);
  mocks.checkAccountWithRequest.mockResolvedValue({ state: "ready" });
  mocks.claudeStatus.mockResolvedValue({ kind: "signed-in", plan: "max" });
  mocks.claudeUsage.mockResolvedValue({ windows: [] });
  mocks.checkGrokSubscriptions.mockResolvedValue(undefined);
  mocks.setChatGPT.mockResolvedValue("GPT");
  mocks.setClaude.mockResolvedValue("Opus");
  mocks.setGrok.mockResolvedValue("Grok 5");
});

describe("checkAccount", () => {
  it.each([
    {
      check: { state: "ready" },
      expected: { kind: "ready", plan: "plus" },
    },
    {
      check: { state: "not-eligible" },
      expected: { kind: "no-plan", plan: "plus" },
    },
    {
      check: { resetsAt: "2026-10-21T20:00:00Z", state: "out-of-usage" },
      expected: { kind: "out-of-usage", resetsAt: "2026-10-21T20:00:00Z" },
    },
    { check: { state: "signed-out" }, expected: { kind: "signed-out" } },
    {
      check: { message: "upstream broke", state: "unknown" },
      expected: { kind: "failed", message: "upstream broke" },
    },
  ])("reads ChatGPT's $check.state as $expected.kind", async (row) => {
    mocks.checkAccountWithRequest.mockResolvedValue(row.check);
    await expect(checkAccount({ provider: "chatgpt" })).resolves.toEqual(
      row.expected,
    );
  });

  it("answers a ChatGPT sign-in that left plan access out as declined, without a request", async () => {
    mocks.chatGPTAccounts = [{ id: "gpt-1", state: "plan-disabled" }];
    await expect(checkAccount({ provider: "chatgpt" })).resolves.toEqual({
      kind: "declined",
    });
    expect(mocks.checkAccountWithRequest).not.toHaveBeenCalled();
  });

  it("answers a plan that lists no models as no-plan", async () => {
    mocks.models.mockResolvedValue([{ ok: true, value: [] }]);
    await expect(checkAccount({ provider: "chatgpt" })).resolves.toEqual({
      kind: "no-plan",
      plan: "plus",
    });
  });

  it("answers Claude out of usage from its windows, until the last full one resets", async () => {
    mocks.claudeUsage.mockResolvedValue({
      windows: [
        { label: "5-hour", resetsAt: "2026-10-21T15:40:00Z", used: 100 },
        { label: "Weekly", resetsAt: "2026-10-24T09:00:00Z", used: 100 },
        { label: "Opus", resetsAt: "2026-10-30T09:00:00Z", used: 40 },
      ],
    });
    await expect(checkAccount({ provider: "claude" })).resolves.toEqual({
      kind: "out-of-usage",
      resetsAt: "2026-10-24T09:00:00Z",
    });
    expect(mocks.checkAccountWithRequest).not.toHaveBeenCalled();
  });

  it("checks Claude with a request when its usage can't be read", async () => {
    mocks.claudeUsage.mockRejectedValue(new Error("no usage"));
    await expect(checkAccount({ provider: "claude" })).resolves.toEqual({
      kind: "ready",
      plan: "max",
    });
  });

  it.each([
    { expected: { kind: "signed-out" }, status: { kind: "signed-out" } },
    { expected: { kind: "signed-out" }, status: { kind: "not-installed" } },
    { expected: { kind: "no-plan" }, status: { kind: "not-a-plan" } },
  ])("answers Claude's $status.kind as $expected.kind", async (row) => {
    mocks.claudeStatus.mockResolvedValue(row.status);
    await expect(checkAccount({ provider: "claude" })).resolves.toEqual(
      row.expected,
    );
  });

  it.each([
    {
      account: { id: "g", plan: "SuperGrok", state: "signed-in" },
      expected: { kind: "ready", plan: "SuperGrok" },
    },
    {
      account: { id: "g", state: "no-subscription" },
      expected: { kind: "no-plan" },
    },
    {
      account: { id: "g", state: "signed-out" },
      expected: { kind: "signed-out" },
    },
  ])("answers Grok's $account.state from the plan xAI names", async (row) => {
    mocks.grokAccounts = [row.account];
    await expect(
      checkAccount({ accountId: "g", provider: "grok" }),
    ).resolves.toEqual(row.expected);
  });

  it("answers timed-out at its deadline, and ends the request", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.checkAccountWithRequest.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        requestSignal = signal;
        return never();
      },
    );
    await expect(
      checkAccount({ deadlineMs: 20, provider: "chatgpt" }),
    ).resolves.toEqual({ kind: "timed-out" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("answers canceled when its caller ends it, even mid-step", async () => {
    mocks.claudeStatus.mockImplementation(never);
    const controller = new AbortController();
    const check = checkAccount({
      provider: "claude",
      signal: controller.signal,
    });
    controller.abort();
    await expect(check).resolves.toEqual({ kind: "canceled" });
  });
});

describe("connectAccount", () => {
  it("makes a ready account's model the default", async () => {
    mocks.defaultModel = "someone/else";
    await expect(connectAccount({ provider: "claude" })).resolves.toEqual({
      modelName: "Opus",
      outcome: { kind: "ready", plan: "max" },
    });
  });

  it.each([
    { check: { state: "not-eligible" } },
    { check: { state: "signed-out" } },
  ])("never makes a $check.state account the default", async ({ check }) => {
    mocks.checkAccountWithRequest.mockResolvedValue(check);
    const { modelName } = await connectAccount({ provider: "chatgpt" });
    expect(modelName).toBeUndefined();
    expect(mocks.setChatGPT).not.toHaveBeenCalled();
  });

  it.each([
    { check: { state: "out-of-usage" } },
    { check: { message: "offline", state: "unknown" } },
  ])(
    "makes a $check.state account the default only when none is chosen",
    async ({ check }) => {
      mocks.checkAccountWithRequest.mockResolvedValue(check);
      mocks.defaultModel = "someone/else";
      await connectAccount({ provider: "chatgpt" });
      expect(mocks.setChatGPT).not.toHaveBeenCalled();
      mocks.defaultModel = undefined;
      await connectAccount({ provider: "chatgpt" });
      expect(mocks.setChatGPT).toHaveBeenCalledWith({ accountId: "gpt-1" });
    },
  );
});
