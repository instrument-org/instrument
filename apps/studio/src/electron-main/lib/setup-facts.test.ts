import { type SetupFacts } from "@/shared/setup";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configs: [] as { id: string; type: string }[],
  getResolvedWorkspace: vi.fn(() => ({
    id: "default",
    machineDir: "/data/machine/default",
    path: "/home/casey/Documents/Instrument",
    pinned: false,
  })),
  lost: undefined as string | undefined,
  placed: false,
  read: undefined as (() => SetupFacts) | undefined,
}));

vi.mock("@/electron-main/lib/account-check", () => ({ checkAccount: vi.fn() }));
vi.mock("@/electron-main/lib/claude-account", () => ({
  claudeAccountStatusKnown: () => Promise.resolve(),
}));
vi.mock("@/electron-main/lib/get-ai-provider-configs", () => ({
  getAllAIProviderConfigs: () => mocks.configs,
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getUserDataDir: () => "/data",
  workspaceInAppData: () => false,
}));
vi.mock("@/electron-main/lib/mac-native", () => ({
  notificationStatus: () => Promise.resolve({ status: "not-asked" }),
}));
vi.mock("@/electron-main/lib/workspace-run", () => ({
  getWorkspaceRun: () =>
    mocks.placed
      ? { kind: "started", workspace: mocks.getResolvedWorkspace() }
      : {
          id: "default",
          kind: "unplaced",
          lost: mocks.lost,
          machineDir: "/data/machine/default",
        },
}));
vi.mock("@/electron-main/lib/workspaces", () => ({
  readRegistry: () => ({ workspaces: [] }),
  workspaceHasChats: () => true,
}));
vi.mock("@/electron-main/lib/tested-before", () => ({
  workspaceTestedBefore: () => true,
}));
vi.mock("@/electron-main/lib/setup-state", () => ({
  provideSetupFacts: (source: { read: () => SetupFacts }) => {
    mocks.read = source.read;
  },
  setupStillAsks: () => false,
}));
vi.mock("@/electron-main/platform-api/client", () => ({
  platformApiRpcClient: {},
}));
vi.mock("@/electron-main/platform-api/utils", () => ({
  getToken: () => undefined,
  hasToken: () => false,
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn(), subscribe: vi.fn() },
}));

const { refreshSetupFacts, startSetupFacts } = await import("./setup-facts");

function read() {
  if (!mocks.read) {
    throw new Error("startSetupFacts provides the facts");
  }
  return mocks.read();
}

describe("setup's facts", () => {
  it("say there is no workspace before the folder step places one, reading nothing in one", () => {
    startSetupFacts();
    expect(read()).toMatchInlineSnapshot(`
      {
        "folderSettled": false,
        "hasChats": false,
        "hasInstrumentAccount": false,
        "hasInstrumentPlan": false,
        "hasOwnAI": false,
        "hasUsableAI": false,
        "hasWorkspace": false,
        "isCheckingPlan": false,
        "lostFolder": null,
        "notificationsAskable": false,
        "testedBefore": false,
      }
    `);
    expect(mocks.getResolvedWorkspace).not.toHaveBeenCalled();
  });

  it("say where a lost folder was", () => {
    mocks.lost = "/home/casey/Documents/Instrument";
    refreshSetupFacts();
    expect(read()).toMatchObject({
      hasWorkspace: false,
      lostFolder: "/home/casey/Documents/Instrument",
    });
  });

  it("read the placed workspace once there is one", () => {
    mocks.placed = true;
    refreshSetupFacts();
    expect(read()).toMatchObject({
      folderSettled: true,
      hasChats: true,
      hasWorkspace: true,
      lostFolder: null,
      testedBefore: true,
    });
  });

  it.each([
    ["Instrument alone", ["instrument"], { hasOwnAI: false, hasUsableAI: true }],
    [
      "Instrument and a key",
      ["instrument", "openai-compatible"],
      { hasOwnAI: true, hasUsableAI: true },
    ],
    ["a key alone", ["anthropic"], { hasOwnAI: true, hasUsableAI: true }],
  ])("count %s as AI of the person's own or not", (_, types, expected) => {
    mocks.configs = types.map((type) => ({ id: type, type }));
    refreshSetupFacts();
    expect(read()).toMatchObject(expected);
  });
});
