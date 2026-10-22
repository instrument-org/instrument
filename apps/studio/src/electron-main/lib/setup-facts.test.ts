import { type SetupFacts } from "@/shared/setup";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResolvedWorkspace: vi.fn(() => ({
    id: "default",
    machineDir: "/data/machine/default",
    path: "/home/casey/Documents/Instrument",
    pinned: false,
  })),
  placed: false,
  read: undefined as (() => SetupFacts) | undefined,
}));

vi.mock("@/electron-main/lib/account-check", () => ({ checkAccount: vi.fn() }));
vi.mock("@/electron-main/lib/claude-account", () => ({
  claudeAccountStatusKnown: () => Promise.resolve(),
}));
vi.mock("@/electron-main/lib/get-ai-provider-configs", () => ({
  getAllAIProviderConfigs: () => [],
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getUserDataDir: () => "/data",
  workspaceInAppData: () => false,
}));
vi.mock("@/electron-main/lib/mac-native", () => ({
  notificationStatus: () => Promise.resolve({ status: "not-asked" }),
}));
vi.mock("@/electron-main/lib/workspaces", () => ({
  getResolvedWorkspace: mocks.getResolvedWorkspace,
  isWorkspacePlaced: () => mocks.placed,
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
        "hasUsableAI": false,
        "hasWorkspace": false,
        "isCheckingPlan": false,
        "notificationsAskable": false,
        "testedBefore": false,
      }
    `);
    expect(mocks.getResolvedWorkspace).not.toHaveBeenCalled();
  });

  it("read the placed workspace once there is one", () => {
    mocks.placed = true;
    refreshSetupFacts();
    expect(read()).toMatchObject({
      folderSettled: true,
      hasChats: true,
      hasWorkspace: true,
      testedBefore: true,
    });
  });
});
