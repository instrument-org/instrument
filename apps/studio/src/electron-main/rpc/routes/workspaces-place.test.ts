import { call, os } from "@orpc/server";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";

const mocks = vi.hoisted(() => ({
  answerSetupByPlacing: vi.fn(),
  refreshSetupFacts: vi.fn(),
  startWorkspace: vi.fn(() => Promise.resolve()),
  userDataDir: "",
}));

vi.mock("@/electron-main/rpc/base", () => {
  const base = os
    .$context<InitialRPCContext>()
    .errors({ API_ERROR: {}, NOT_FOUND: {}, UNAUTHORIZED: {} });
  return { base, devOnly: base };
});
vi.mock("@/electron-main/auth/client", () => ({ revokeSession: vi.fn() }));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock(
  import("@/electron-main/lib/get-workspace-folder"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    getUserDataDir: () => mocks.userDataDir,
  }),
);
vi.mock("@/electron-main/lib/setup-facts", () => ({
  refreshSetupFacts: mocks.refreshSetupFacts,
}));
vi.mock("@/electron-main/lib/setup-state", () => ({
  answerSetupByPlacing: mocks.answerSetupByPlacing,
}));
vi.mock("@/electron-main/lib/start-workspace", () => ({
  startWorkspace: mocks.startWorkspace,
}));
vi.mock("@/electron-main/lib/relaunch", () => ({
  canRelaunch: () => false,
  relaunchApp: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => false,
}));
vi.mock("@/electron-main/stores/workspace/session", () => ({
  readBearerTokensIn: () => ({}),
}));
vi.mock("@/electron-main/platform-api/base-url", () => ({
  platformApiBaseUrl: () => "https://api.example",
  platformApiOrigin: () => "https://api.example",
}));

const log = { info: () => {}, warn: () => {} };

let root: string;
let home: string;
// Fresh per test: which workspace the process runs is module state.
let lib: typeof import("../../lib/workspaces");
let route: typeof import("./workspaces");

beforeEach(async () => {
  vi.resetModules();
  lib = await import("../../lib/workspaces");
  route = await import("./workspaces");
  const { resolveLaunchWorkspace } = await import("../../lib/open-workspace");
  root = fs.mkdtempSync(path.join(tmpdir(), "workspaces-place-"));
  mocks.userDataDir = path.join(root, "userData");
  home = path.join(root, "home");
  fs.mkdirSync(mocks.userDataDir);
  fs.mkdirSync(path.join(home, "Documents"), { recursive: true });
  // A first launch, as setup-environment leaves it.
  const launched = resolveLaunchWorkspace({
    log,
    packaged: false,
    pin: undefined,
    userDataDir: mocks.userDataDir,
  });
  if (launched.kind !== "unplaced") {
    throw new Error("Expected a launch with no workspace");
  }
  lib.setUnplacedWorkspace(launched.workspace);
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
  vi.clearAllMocks();
});

const context = {} as InitialRPCContext;

function place(input: { create?: boolean; path: string }) {
  return call(route.workspaces.place, input, { context });
}

describe("workspaces.place", () => {
  it("makes the folder, places the workspace in it, and starts it once", async () => {
    const dir = path.join(home, "Documents", "Instrument");

    expect(await place({ create: true, path: dir })).toEqual({
      kind: "placed",
    });

    expect(lib.isWorkspacePlaced()).toBe(true);
    expect(lib.getResolvedWorkspace()).toMatchObject({
      id: "default",
      path: dir,
    });
    expect(lib.readWorkspaceIdentity(dir).name).toBe("Default");
    expect(lib.readRegistry(mocks.userDataDir)).toMatchObject({
      active: "default",
      workspaces: [{ id: "default", path: dir }],
    });
    expect(mocks.startWorkspace).toHaveBeenCalledOnce();
    expect(mocks.answerSetupByPlacing).toHaveBeenCalledOnce();
    expect(mocks.refreshSetupFacts).toHaveBeenCalled();
    // Once placed, there is nothing left to place.
    await expect(place({ path: dir })).rejects.toThrow(
      "The workspace has a folder",
    );
  });

  it("takes a folder it made away again when it can't keep the workspace there", async () => {
    // Inside the app's own data, where no workspace the person picks can be.
    const dir = path.join(mocks.userDataDir, "Mine");

    expect(await place({ create: true, path: dir })).toMatchObject({
      kind: "refused",
      reason: "own-data",
    });

    expect(fs.existsSync(dir)).toBe(false);
    expect(lib.isWorkspacePlaced()).toBe(false);
    expect(fs.existsSync(path.join(mocks.userDataDir, "workspaces.json"))).toBe(
      false,
    );
    expect(mocks.startWorkspace).not.toHaveBeenCalled();
    expect(mocks.answerSetupByPlacing).not.toHaveBeenCalled();
  });

  it("answers a missing folder it wasn't asked to make", async () => {
    expect(
      await place({ path: path.join(home, "Documents", "Not there") }),
    ).toMatchObject({ kind: "refused", reason: "missing" });
    expect(lib.isWorkspacePlaced()).toBe(false);
  });
});
