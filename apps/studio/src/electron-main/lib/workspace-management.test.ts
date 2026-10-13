import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceSettingsDirOf } from "./settings-migration";
import {
  createWorkspace,
  keysDirOf,
  listWorkspaces,
  registerStray,
  unregisterWorkspace,
  whyNotDeletable,
} from "./workspace-management";
import {
  defaultWorkspacePath,
  machineDirOwnedBy,
  markWorkspaceOpen,
  readRegistry,
  readWorkspaceIdentity,
  releaseOpenMark,
  type ResolvedWorkspace,
  settleWorkspaceId,
  updateRegistry,
  workspaceMachineDirOf,
  workspacePrivateDir,
  writeWorkspaceIdentity,
} from "./workspaces";

let userDataDir: string;
let resolved: ResolvedWorkspace;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-mgmt-"));
  resolved = {
    id: "default",
    isDefault: true,
    path: defaultWorkspacePath(userDataDir),
    pinned: false,
  };
});

afterEach(() => {
  fs.rmSync(userDataDir, { force: true, recursive: true });
});

function entriesOf(dir: string) {
  return fs.readdirSync(dir).toSorted();
}

/** The machine folder the workspace at `dir` settled on. */
function machineDirOf(dir: string) {
  const machineDir = machineDirOwnedBy(userDataDir, dir);
  if (machineDir === undefined) {
    throw new Error(`${dir} has no machine folder`);
  }
  return machineDir;
}

describe("createWorkspace", () => {
  it("starts blank, signed out, with developer mode as the creator had it", () => {
    const { id, path: dir } = createWorkspace({
      color: "teal",
      copySignInsFrom: null,
      developerMode: true,
      name: "BYOK only",
      userDataDir,
    });
    expect(id).toBe("byok-only");
    expect(entriesOf(workspacePrivateDir(dir))).toEqual([
      "preferences.json",
      "workspace.json",
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(workspacePrivateDir(dir), "preferences.json"),
          "utf8",
        ),
      ),
    ).toEqual({ developerMode: true });
    // Already in the current format, with an id of its own and a machine
    // folder holding nothing but the record of whose it is.
    const identity = readWorkspaceIdentity(dir);
    expect(identity.formatVersion).toBe(1);
    expect(identity.id).toMatch(/^[\dA-Z]{26}$/);
    expect(entriesOf(machineDirOf(dir))).toEqual(["workspace-folder.json"]);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "byok-only",
    ]);
  });

  it("copies only the sign-in stores when asked", () => {
    const from = path.join(userDataDir, "keys-of-the-open-workspace");
    fs.mkdirSync(from, { recursive: true });
    for (const file of [
      "session-dev.json",
      "providers.json",
      "chatgpt-account.json",
      "app-oauth.json",
      "app-connections.json",
      "features.json",
    ]) {
      fs.writeFileSync(path.join(from, file), "{}");
    }
    const { path: dir } = createWorkspace({
      color: "blue",
      copySignInsFrom: from,
      developerMode: false,
      name: "Second account",
      userDataDir,
    });
    // Not the ChatGPT account: two holders of its rotating refresh token sign
    // each other out.
    expect(entriesOf(path.join(machineDirOf(dir), "keys"))).toEqual([
      "providers.json",
      "session-dev.json",
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(machineDirOf(dir), "state.json"), "utf8"),
      ),
    ).toEqual({ hasCompletedProviderSetup: true });
    expect(entriesOf(workspacePrivateDir(dir))).toEqual([
      "preferences.json",
      "workspace.json",
    ]);
  });

  it("gives a repeated name its own folder", () => {
    for (const _ of [1, 2]) {
      createWorkspace({
        color: "gray",
        copySignInsFrom: null,
        developerMode: true,
        name: "Scratch",
        userDataDir,
      });
    }
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "scratch",
      "scratch-2",
    ]);
  });
});

describe("listWorkspaces", () => {
  it("lists strays, drops entries whose folder is gone, and marks the resolved one", () => {
    const { path: kept } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Kept",
      userDataDir,
    });
    const gone = path.join(userDataDir, "elsewhere", "clean-room");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [...registry.workspaces, { id: "clean-room", path: gone }],
    }));
    const stray = path.join(userDataDir, "workspaces", "stray");
    writeWorkspaceIdentity(stray, {
      color: "red",
      createdBy: { kind: "person" },
      formatVersion: 0,
      name: "Stray",
      settingsVersion: 1,
    });

    const listed = listWorkspaces({ resolved, userDataDir });
    expect(
      listed.map(({ id, isRegistered, isResolved, path: dir }) => ({
        dir,
        id,
        isRegistered,
        isResolved,
      })),
    ).toEqual([
      {
        dir: resolved.path,
        id: "default",
        isRegistered: true,
        isResolved: true,
      },
      { dir: kept, id: "kept", isRegistered: true, isResolved: false },
      { dir: stray, id: "stray", isRegistered: false, isResolved: false },
    ]);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "kept",
    ]);

    expect(registerStray({ dir: stray, resolved, userDataDir })).toBe(true);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "kept",
      "stray",
    ]);
  });
});

describe("where a workspace's own data is", () => {
  it("finds the sign-ins in the machine folder, or the settings folder of one not yet moved", () => {
    const { path: moved } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Moved",
      userDataDir,
    });
    expect(keysDirOf(userDataDir, moved)).toBe(
      path.join(machineDirOf(moved), "keys"),
    );
    expect(keysDirOf(userDataDir, resolved.path)).toBe(
      workspaceSettingsDirOf(resolved.path),
    );
  });

  it("reports a workspace another process holds open by its machine folder's mark", () => {
    const { path: dir } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Busy",
      userDataDir,
    });
    fs.writeFileSync(
      path.join(machineDirOf(dir), "open.pid"),
      process.ppid.toString(),
    );
    const busy = () =>
      listWorkspaces({ resolved, userDataDir }).find(
        (listing) => listing.path === dir,
      )?.openElsewhereBy;
    expect(busy()).toBe(process.ppid);

    fs.rmSync(path.join(machineDirOf(dir), "open.pid"));
    markWorkspaceOpen(machineDirOf(dir));
    expect(busy()).toBeNull();
    releaseOpenMark(machineDirOf(dir));
  });

  it("gives a copy of a workspace an id and machine folder of its own", () => {
    const { path: original } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Original",
      userDataDir,
    });
    const copy = path.join(userDataDir, "elsewhere", "copy");
    fs.cpSync(original, copy, { recursive: true });
    expect(machineDirOwnedBy(userDataDir, copy)).toBeUndefined();

    const copyId = settleWorkspaceId({ userDataDir, workspacePath: copy });

    expect(copyId).not.toBe(readWorkspaceIdentity(original).id);
    expect(machineDirOf(copy)).toBe(workspaceMachineDirOf(userDataDir, copyId));
    expect(machineDirOf(original)).not.toBe(machineDirOf(copy));
  });

  it("keeps the id and machine folder of a workspace whose folder moved", () => {
    const { path: before } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Wanderer",
      userDataDir,
    });
    const machineDir = machineDirOf(before);
    const after = path.join(userDataDir, "elsewhere", "wanderer");
    fs.mkdirSync(path.dirname(after), { recursive: true });
    fs.renameSync(before, after);

    const id = settleWorkspaceId({ userDataDir, workspacePath: after });

    expect(workspaceMachineDirOf(userDataDir, id)).toBe(machineDir);
    expect(machineDirOf(after)).toBe(machineDir);
  });
});

describe("registerStray", () => {
  it.each([
    [
      "the default workspace's folder, spelled differently",
      () => `${resolved.path}/`,
    ],
    ["a folder that is no workspace", () => os.homedir()],
    ["a relative path", () => "workspaces/nothing"],
  ])("refuses %s", (_, dir) => {
    expect(registerStray({ dir: dir(), resolved, userDataDir })).toBe(false);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
    ]);
  });
});

describe("deleting", () => {
  it("never offers the default workspace's folder under another id", () => {
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [
        ...registry.workspaces,
        { id: "workspace", path: `${resolved.path}/` },
      ],
    }));
    const listed = listWorkspaces({ resolved, userDataDir });
    expect(listed.map((row) => [row.id, row.isDefault])).toEqual([
      ["default", true],
    ]);
  });

  it.each([
    [{ isDefault: true, isResolved: false, openElsewhereBy: null }, true],
    [{ isDefault: false, isResolved: true, openElsewhereBy: null }, true],
    [{ isDefault: false, isResolved: false, openElsewhereBy: 42 }, true],
    [{ isDefault: false, isResolved: false, openElsewhereBy: null }, false],
  ])("blocks %o: %s", (listing, blocked) => {
    expect(
      whyNotDeletable(
        { ...listing, path: "/home/me/Projects/notes" },
        "/home/me/.config/Instrument",
      ) !== null,
    ).toBe(blocked);
  });

  it.each([
    ["/home/me", true],
    ["/home/me/.config/Instrument", true],
    ["/home/me/.config/Instrument/workspaces/side", false],
    ["/home/me/.config/Instrument-other", false],
  ])("blocks deleting %s while userData is inside it: %s", (dir, blocked) => {
    const listing = {
      isDefault: false,
      isResolved: false,
      openElsewhereBy: null,
      path: dir,
    };
    expect(
      whyNotDeletable(listing, "/home/me/.config/Instrument") !== null,
    ).toBe(blocked);
  });

  it("sends active back to the default workspace when the active one is unregistered", () => {
    const { id, path: dir } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Old",
      userDataDir,
    });
    updateRegistry(userDataDir, (registry) => ({ ...registry, active: id }));
    unregisterWorkspace({ dir, userDataDir });
    expect(readRegistry(userDataDir)).toMatchObject({ active: "default" });
    expect(fs.existsSync(workspacePrivateDir(dir))).toBe(true);
  });
});
