import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveLaunchWorkspace } from "./open-workspace";
import { choosePlacement, placeWorkspace } from "./place-workspace";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import { checkMoveTarget } from "./workspace-move";
import {
  defaultWorkspacePath,
  readRegistry,
  readWorkspaceIdentity,
  registerWorkspaceFolder,
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
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "place-workspace-")),
  );
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
  return launched;
}

/** A workspace in this build's format at `dir`, with its own id. */
function workspaceAt(dir: string, id: string, formatVersion = 2) {
  writeWorkspaceIdentity(dir, {
    ...readWorkspaceIdentity(dir),
    formatVersion,
    id,
    name: path.basename(dir),
    settingsVersion:
      formatVersion >= WORKSPACE_FORMAT_VERSION ? CURRENT_SETTINGS_VERSION : 0,
  });
}

/** A computer whose default workspace, `id`, was placed at `dir` and has a sign-in. */
function placedBefore(dir: string, id: string) {
  workspaceAt(dir, id);
  updateRegistry(userDataDir, () => ({
    active: "default",
    workspaces: [{ id: "default", path: dir, workspaceId: id }],
  }));
  const machineDir = workspaceMachineDirOf(userDataDir, "default");
  writeJsonAtomic(path.join(machineDir, "owner.json"), { workspaceId: id });
  writeJsonAtomic(path.join(machineDir, "keys", "providers.json"), {
    signedIn: true,
  });
  return machineDir;
}

describe("the launch decision", () => {
  it("places nothing on a first launch: only this computer's folder for the default local id", () => {
    expect(unplaced()).toEqual({
      id: "default",
      kind: "unplaced",
      machineDir: workspaceMachineDirOf(userDataDir, "default"),
    });
    expect(fs.existsSync(defaultWorkspacePath(userDataDir))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, "workspaces.json"))).toBe(
      false,
    );
    // And stays without one until one is placed.
    expect(launch().kind).toBe("unplaced");
  });

  it("opens a placed workspace", () => {
    const dir = path.join(home, "Instrument");
    placedBefore(dir, "01PLACED");
    expect(launch()).toMatchObject({ kind: "open", workspace: { path: dir } });
  });

  it("asks for a missing folder again, saying where it was, keeping its machine folder", () => {
    const dir = path.join(home, "Instrument");
    const machineDir = placedBefore(dir, "01PLACED");
    fs.rmSync(dir, { recursive: true });
    expect(launch()).toEqual({
      id: "default",
      kind: "unplaced",
      lost: dir,
      machineDir,
    });
    expect(fs.existsSync(path.join(machineDir, "keys", "providers.json"))).toBe(
      true,
    );
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "asks for a folder it may not read again",
    () => {
      const dir = path.join(home, "Instrument");
      placedBefore(dir, "01PLACED");
      fs.chmodSync(workspaceLayout(dir).dataDir, 0o000);
      try {
        expect(launch()).toMatchObject({ kind: "unplaced", lost: dir });
      } finally {
        fs.chmodSync(workspaceLayout(dir).dataDir, 0o755);
      }
    },
  );

  it("refuses a folder a newer build made", () => {
    const dir = path.join(home, "Instrument");
    placedBefore(dir, "01PLACED");
    workspaceAt(dir, "01PLACED", WORKSPACE_FORMAT_VERSION + 1);
    expect(launch()).toMatchObject({
      kind: "refused",
      refusal: { kind: "newer" },
    });
  });

  it("opens the default workspace an earlier build kept in the app's own data", () => {
    fs.mkdirSync(path.join(defaultWorkspacePath(userDataDir), "tasks"), {
      recursive: true,
    });
    expect(launch().kind).toBe("open");
  });

  it("opens a workspace pinned for the process", () => {
    expect(
      resolveLaunchWorkspace({
        log,
        packaged: false,
        pin: path.join(root, "pinned"),
        userDataDir,
      }).kind,
    ).toBe("open");
  });
});

describe("placeWorkspace", () => {
  it("makes a workspace in the picked folder under the launch's local id", () => {
    const local = unplaced();
    const dir = path.join(home, "Documents", "Instrument");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "the person's own");

    expect(choosePlacement({ dir, unplaced: local, userDataDir })).toEqual({
      kind: "here",
    });
    const opened = placeWorkspace({
      dir,
      home,
      log,
      packaged: false,
      unplaced: local,
      userDataDir,
    });

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
    expect(readRegistry(userDataDir)).toMatchObject({
      active: "default",
      workspaces: [{ id: "default", path: dir, workspaceId: identity.id }],
    });
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe(
      "the person's own",
    );
    expect(launch()).toMatchObject({ kind: "open", workspace: { path: dir } });
  });

  it("re-points a lost workspace found where it moved, keeping its sign-ins", () => {
    const was = path.join(home, "Instrument");
    const machineDir = placedBefore(was, "01PLACED");
    const now = path.join(home, "Moved", "Instrument");
    fs.mkdirSync(path.dirname(now), { recursive: true });
    fs.renameSync(was, now);
    const local = unplaced();

    expect(choosePlacement({ dir: now, unplaced: local, userDataDir })).toEqual(
      { kind: "here" },
    );
    placeWorkspace({
      dir: now,
      home,
      log,
      packaged: false,
      unplaced: local,
      userDataDir,
    });
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default", path: now, workspaceId: "01PLACED" },
    ]);
    expect(readWorkspaceIdentity(now).id).toBe("01PLACED");
    expect(fs.existsSync(path.join(machineDir, "keys", "providers.json"))).toBe(
      true,
    );
  });

  it("makes a new folder for a lost workspace under its local id, keeping its sign-ins", () => {
    const was = path.join(home, "Instrument");
    const machineDir = placedBefore(was, "01PLACED");
    fs.rmSync(was, { recursive: true });
    const local = unplaced();
    const dir = path.join(home, "New");
    fs.mkdirSync(dir);

    placeWorkspace({
      dir,
      home,
      log,
      packaged: false,
      unplaced: local,
      userDataDir,
    });
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default", path: dir },
    ]);
    expect(fs.existsSync(path.join(machineDir, "keys", "providers.json"))).toBe(
      true,
    );
  });
});

describe("choosePlacement", () => {
  it("restarts into a different workspace under a local id of its own, while the lost one's machine folder stays its", () => {
    const was = path.join(home, "Instrument");
    placedBefore(was, "01PLACED");
    fs.rmSync(was, { recursive: true });
    const local = unplaced();
    const other = path.join(home, "Other");
    workspaceAt(other, "01OTHER");

    const how = choosePlacement({ dir: other, unplaced: local, userDataDir });
    expect(how).toEqual({ id: "other", kind: "restart" });
    expect(readRegistry(userDataDir)).toMatchObject({
      active: "other",
      workspaces: [
        { id: "default", path: was, workspaceId: "01PLACED" },
        { id: "other", path: other },
      ],
    });
  });

  it("re-points the entry of the same workspace under another local id, by restarting into it", () => {
    const lab = path.join(home, "Lab");
    workspaceAt(lab, "01LAB");
    updateRegistry(userDataDir, () => ({
      workspaces: [{ id: "lab", path: lab, workspaceId: "01LAB" }],
    }));
    const moved = path.join(home, "Lab moved");
    fs.renameSync(lab, moved);
    const local = unplaced();

    expect(
      choosePlacement({ dir: moved, unplaced: local, userDataDir }),
    ).toEqual({ id: "lab", kind: "restart" });
    expect(
      readRegistry(userDataDir).workspaces.find((entry) => entry.id === "lab"),
    ).toMatchObject({ path: moved, workspaceId: "01LAB" });
  });

  it("restarts into a workspace an earlier build left in an older format, under this local id", () => {
    const local = unplaced();
    const older = path.join(home, "Older");
    workspaceAt(older, "01OLDER", 0);

    expect(
      choosePlacement({ dir: older, unplaced: local, userDataDir }),
    ).toEqual({ id: "default", kind: "restart" });
    expect(readRegistry(userDataDir)).toMatchObject({
      active: "default",
      workspaces: [{ id: "default", path: older }],
    });
  });
});

describe("registerWorkspaceFolder", () => {
  it("re-points the same workspace's entry, and gives a copy beside the original an id of its own", () => {
    const lab = path.join(home, "Lab");
    workspaceAt(lab, "01LAB");
    updateRegistry(userDataDir, () => ({
      workspaces: [{ id: "lab", path: lab, workspaceId: "01LAB" }],
    }));
    const copy = path.join(home, "Lab copy");
    fs.cpSync(lab, copy, { recursive: true });
    expect(registerWorkspaceFolder({ dir: copy, userDataDir })).toEqual({
      id: "lab-copy",
    });

    fs.rmSync(lab, { recursive: true });
    const moved = path.join(home, "Lab moved");
    fs.renameSync(copy, moved);
    // The copy's entry now names a folder that isn't there; the original's
    // too. The first entry carrying the id is re-pointed.
    expect(registerWorkspaceFolder({ dir: moved, userDataDir })).toEqual({
      id: "lab",
    });
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
    workspaceAt(earlier, "01EARLIER");
    expect(place(earlier)).toMatchObject({
      kind: "workspace",
      name: "Earlier",
    });

    const newer = path.join(home, "Newer");
    workspaceAt(newer, "01NEWER", WORKSPACE_FORMAT_VERSION + 1);
    expect(place(newer)).toMatchObject({ kind: "refused", reason: "newer" });

    expect(place(path.join(home, "Not there"))).toMatchObject({
      kind: "refused",
      reason: "missing",
    });
  });
});
