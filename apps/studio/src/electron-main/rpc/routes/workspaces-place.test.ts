import { call, os } from "@orpc/server";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";

const mocks = vi.hoisted(() => ({
  answerSetupByPlacing: vi.fn(),
  answerSetupIn: vi.fn(),
  refreshSetupFacts: vi.fn(),
  relaunchApp: vi.fn(({ beforeRestart }: { beforeRestart: () => void }) => {
    beforeRestart();
    return Promise.resolve("relaunching");
  }),
  restartNow: vi.fn(() => true),
  setupUp: false,
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
  answerSetupIn: mocks.answerSetupIn,
  isSetupUp: () => mocks.setupUp,
  rereadSetupRecord: vi.fn(),
}));
vi.mock("@/electron-main/lib/start-workspace", () => ({
  startWorkspace: mocks.startWorkspace,
}));
vi.mock("@/electron-main/lib/relaunch", () => ({
  canRelaunch: () => true,
  relaunchApp: mocks.relaunchApp,
  restartNow: mocks.restartNow,
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
let run: typeof import("../../lib/workspace-run");
let route: typeof import("./workspaces");

beforeEach(async () => {
  vi.resetModules();
  mocks.setupUp = false;
  lib = await import("../../lib/workspaces");
  run = await import("../../lib/workspace-run");
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
  run.beginWorkspaceRun(launched);
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

    expect(run.getWorkspaceRun().kind !== "unplaced").toBe(true);
    expect(run.getResolvedWorkspace()).toMatchObject({
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
  });

  it("takes a folder it made away again when it can't keep the workspace there", async () => {
    // Inside the app's own data, where no workspace the person picks can be.
    const dir = path.join(mocks.userDataDir, "Mine");

    expect(await place({ create: true, path: dir })).toMatchObject({
      kind: "refused",
      reason: "own-data",
    });

    expect(fs.existsSync(dir)).toBe(false);
    expect(run.getWorkspaceRun().kind !== "unplaced").toBe(false);
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
    expect(run.getWorkspaceRun().kind !== "unplaced").toBe(false);
  });

  // Placing writes the record again from what it read, so one that won't
  // read would be written over with defaults.
  it("leaves a folder whose record is there but won't read as it is", async () => {
    const dir = path.join(home, "Documents", "Instrument");
    const record = path.join(dir, ".instrument", "workspace.json");
    // A record that is a folder fails to read with a code no folder explains.
    fs.mkdirSync(record, { recursive: true });

    expect(await place({ path: dir })).toEqual({
      kind: "unreachable",
      reason: "unreadable",
    });
    expect(fs.statSync(record).isDirectory()).toBe(true);
    expect(run.getWorkspaceRun().kind).toBe("unplaced");
    expect(mocks.startWorkspace).not.toHaveBeenCalled();
  });
});

describe("workspaces.place after a start that failed", () => {
  it("starts the placed workspace again rather than placing it twice", async () => {
    const dir = path.join(home, "Documents", "Instrument");
    mocks.startWorkspace.mockRejectedValueOnce(new Error("no actor"));
    await expect(place({ create: true, path: dir })).rejects.toThrow(
      "no actor",
    );
    expect(await place({ path: dir })).toEqual({ kind: "placed" });
    expect(mocks.startWorkspace).toHaveBeenCalledTimes(2);
    expect(run.getResolvedWorkspace()).toMatchObject({ path: dir });
  });
});

describe("workspaces.open, from Settings", () => {
  /** A placed default workspace at `dir`, running. */
  async function placedAt(dir: string) {
    expect(await place({ create: true, path: dir })).toEqual({
      kind: "placed",
    });
  }

  function open(dir: string) {
    return call(route.workspaces.open, { path: dir }, { context });
  }

  it("opens another Instrument folder under a local id of its own, with one restart, leaving both", async () => {
    const mine = path.join(home, "Documents", "Instrument");
    await placedAt(mine);
    const other = path.join(home, "Other");
    lib.writeWorkspaceIdentity(other, {
      ...lib.readWorkspaceIdentity(other),
      formatVersion: lib.WORKSPACE_FORMAT_VERSION,
      id: "01OTHER",
      settingsVersion: 2,
    });

    expect(await open(other)).toEqual({ outcome: "relaunching" });
    expect(lib.readRegistry(mocks.userDataDir)).toMatchObject({
      active: "other",
      workspaces: [
        { id: "default", path: mine },
        { id: "other", path: other },
      ],
    });
    expect(lib.readWorkspaceIdentity(mine).id).toBeDefined();
    expect(mocks.answerSetupIn).not.toHaveBeenCalled();
  });

  it("re-points the same workspace found where it moved, keeping its local id", async () => {
    const lab = path.join(home, "Lab");
    lib.writeWorkspaceIdentity(lab, {
      ...lib.readWorkspaceIdentity(lab),
      formatVersion: lib.WORKSPACE_FORMAT_VERSION,
      id: "01LAB",
      settingsVersion: 2,
    });
    lib.updateRegistry(mocks.userDataDir, (registry) => ({
      ...registry,
      workspaces: [
        ...registry.workspaces,
        { id: "lab", path: lab, workspaceId: "01LAB" },
      ],
    }));
    await placedAt(path.join(home, "Documents", "Instrument"));
    const moved = path.join(home, "Lab moved");
    fs.renameSync(lab, moved);

    expect(await open(moved)).toEqual({ outcome: "relaunching" });
    expect(lib.readRegistry(mocks.userDataDir)).toMatchObject({
      active: "lab",
    });
    expect(
      lib
        .readRegistry(mocks.userDataDir)
        .workspaces.find((entry) => entry.id === "lab"),
    ).toMatchObject({ path: moved, workspaceId: "01LAB" });
  });

  it("answers setup's folder step in the workspace it opens from setup", async () => {
    await placedAt(path.join(home, "Documents", "Instrument"));
    const other = path.join(home, "Other");
    lib.writeWorkspaceIdentity(other, lib.readWorkspaceIdentity(other));
    mocks.setupUp = true;
    expect(await open(other)).toEqual({ outcome: "relaunching" });
    expect(mocks.answerSetupIn).toHaveBeenCalledWith(
      lib.workspaceMachineDirOf(mocks.userDataDir, "other"),
    );
  });

  it("answers a folder holding no Instrument folder", async () => {
    await placedAt(path.join(home, "Documents", "Instrument"));
    const plain = path.join(home, "Plain");
    fs.mkdirSync(plain);
    expect(await open(plain)).toEqual({ outcome: "not-a-workspace" });
  });
});
