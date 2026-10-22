import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveLaunchWorkspace } from "./open-workspace";
import { placeWorkspace } from "./place-workspace";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import { checkMoveTarget } from "./workspace-move";
import {
  defaultWorkspacePath,
  getResolvedWorkspace,
  isWorkspacePlaced,
  needsPlacing,
  readRegistry,
  readWorkspaceIdentity,
  updateRegistry,
  WORKSPACE_FORMAT_VERSION,
  workspaceMachineDirOf,
  writeJsonAtomic,
  writeWorkspaceIdentity,
} from "./workspaces";

const log = { info: () => {}, warn: () => {} };

let root: string;
let userDataDir: string;
let home: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "place-workspace-"));
  userDataDir = path.join(root, "userData");
  home = path.join(root, "home");
  fs.mkdirSync(userDataDir);
  fs.mkdirSync(home);
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

/** What a launch with no pin makes of this userData. */
function launch() {
  return resolveLaunchWorkspace({
    log,
    packaged: false,
    pin: undefined,
    userDataDir,
  });
}

function unplaced() {
  const launched = launch();
  if (launched.kind !== "unplaced") {
    throw new Error(`Expected no workspace, got ${launched.kind}`);
  }
  return launched.workspace;
}

describe("a launch with no workspace", () => {
  it("places nothing: only this computer's folder for the default local id", () => {
    expect(unplaced()).toEqual({
      id: "default",
      machineDir: workspaceMachineDirOf(userDataDir, "default"),
    });
    expect(fs.existsSync(defaultWorkspacePath(userDataDir))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "workspaces.json"))).toBe(
      false,
    );
    expect(fs.existsSync(workspaceMachineDirOf(userDataDir, "default"))).toBe(
      true,
    );
  });

  it("stays without one across launches until one is placed", () => {
    unplaced();
    expect(launch().kind).toBe("unplaced");
  });

  it("opens the default workspace still in the app's own data", () => {
    fs.mkdirSync(path.join(defaultWorkspacePath(userDataDir), "tasks"), {
      recursive: true,
    });
    expect(needsPlacing(userDataDir)).toBe(false);
    expect(launch().kind).toBe("open");
  });

  it("opens a 1.x computer's settings into the default workspace", () => {
    fs.writeFileSync(path.join(userDataDir, "preferences.json"), "{}");
    expect(needsPlacing(userDataDir)).toBe(false);
  });

  it("opens a workspace pinned for the process", () => {
    const launched = resolveLaunchWorkspace({
      log,
      packaged: false,
      pin: path.join(root, "pinned"),
      userDataDir,
    });
    expect(launched.kind).toBe("open");
  });

  it("asks for a folder again when the default one in app data is gone, setting its machine data aside", () => {
    const machineDir = workspaceMachineDirOf(userDataDir, "default");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [
        {
          id: "default",
          path: defaultWorkspacePath(userDataDir),
          workspaceId: "01GONE",
        },
      ],
    }));
    writeJsonAtomic(path.join(machineDir, "owner.json"), {
      workspaceId: "01GONE",
    });
    expect(unplaced().machineDir).toBe(machineDir);
    expect(fs.existsSync(path.join(machineDir, "owner.json"))).toBe(false);
    expect(fs.existsSync(`${machineDir}.01GONE`)).toBe(true);
  });

  it("opens a default workspace the person moved out of app data, wherever it is", () => {
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [{ id: "default", path: path.join(home, "Instrument") }],
    }));
    expect(needsPlacing(userDataDir)).toBe(false);
  });
});

describe("placeWorkspace", () => {
  it("makes a workspace in the picked folder under the launch's local id", () => {
    const local = unplaced();
    const dir = path.join(home, "Documents", "Instrument");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "the person's own");

    const opened = placeWorkspace({
      dir,
      home,
      log,
      packaged: false,
      unplaced: local,
      userDataDir,
    });

    expect(isWorkspacePlaced()).toBe(true);
    expect(getResolvedWorkspace()).toBe(opened);
    expect(opened).toMatchObject({
      id: "default",
      isDefault: true,
      machineDir: local.machineDir,
      path: dir,
      pinned: false,
    });
    const identity = readWorkspaceIdentity(dir);
    expect(identity).toMatchObject({
      formatVersion: WORKSPACE_FORMAT_VERSION,
      name: "Default",
      settingsVersion: CURRENT_SETTINGS_VERSION,
    });
    expect(identity.id).toBeDefined();
    expect(readRegistry(userDataDir)).toMatchObject({
      active: "default",
      workspaces: [{ id: "default", path: dir, workspaceId: identity.id }],
    });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(local.machineDir, "owner.json"), "utf8"),
      ),
    ).toEqual({ workspaceId: identity.id });
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe(
      "the person's own",
    );
    expect(fs.existsSync(defaultWorkspacePath(userDataDir))).toBe(false);
    // The next launch opens it there.
    expect(launch()).toMatchObject({ kind: "open", workspace: { path: dir } });
  });

  it("opens the workspace already in the picked folder, keeping its id and name", () => {
    const local = unplaced();
    const dir = path.join(home, "Instrument");
    writeWorkspaceIdentity(dir, {
      ...readWorkspaceIdentity(dir),
      formatVersion: WORKSPACE_FORMAT_VERSION,
      id: "01EARLIER",
      name: "Casey's",
      settingsVersion: CURRENT_SETTINGS_VERSION,
    });
    fs.mkdirSync(path.join(workspaceLayout(dir).chatsDir, "c1"), {
      recursive: true,
    });

    placeWorkspace({
      dir,
      home,
      log,
      packaged: false,
      unplaced: local,
      userDataDir,
    });

    expect(readWorkspaceIdentity(dir)).toMatchObject({
      id: "01EARLIER",
      name: "Casey's",
    });
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default", path: dir, workspaceId: "01EARLIER" },
    ]);
    expect(fs.readdirSync(workspaceLayout(dir).chatsDir)).toEqual(["c1"]);
  });
});

describe("checking a folder for a workspace with no folder yet", () => {
  const place = (target: string) =>
    checkMoveTarget({
      target,
      temporaryDirs: [],
      userDataDir,
      workspace: { id: "default", path: undefined, pinned: false },
    });

  it("takes a folder that is there, offers to open a workspace, and refuses a newer build's", () => {
    const empty = path.join(home, "Instrument");
    fs.mkdirSync(empty);
    expect(place(empty).kind).toBe("movable");

    const earlier = path.join(home, "Earlier");
    writeWorkspaceIdentity(earlier, {
      ...readWorkspaceIdentity(earlier),
      name: "Earlier",
    });
    expect(place(earlier)).toMatchObject({
      kind: "workspace",
      name: "Earlier",
    });

    const newer = path.join(home, "Newer");
    writeWorkspaceIdentity(newer, {
      ...readWorkspaceIdentity(newer),
      formatVersion: WORKSPACE_FORMAT_VERSION + 1,
    });
    expect(place(newer)).toMatchObject({ kind: "refused", reason: "newer" });

    expect(place(path.join(home, "Not there"))).toMatchObject({
      kind: "refused",
      reason: "missing",
    });
  });
});
