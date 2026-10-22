import { WORKSPACE_LAYOUT_VERSION } from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startLiveProcess } from "../../tests/live-process";
import { workspaceSettingsDirOf } from "./settings-migration";
import {
  createWorkspace,
  keysDirOf,
  listWorkspaces,
  registerStray,
  removeFolderIfEmpty,
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
  updateRegistry,
  writeWorkspaceIdentity,
  WORKSPACE_FORMAT_VERSION,
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

/** The machine folder a created workspace settled on. */
function machineDirOf(workspace: { id: string; path: string }) {
  const machineDir = machineDirOwnedBy(userDataDir, workspace);
  if (machineDir === undefined) {
    throw new Error(`${workspace.path} has no machine folder`);
  }
  return machineDir;
}

describe("createWorkspace", () => {
  it("starts blank, signed out, with developer mode as the creator had it", () => {
    const created = createWorkspace({
      color: "teal",
      copySignInsFrom: null,
      developerMode: true,
      name: "BYOK only",
      userDataDir,
    });
    const { id, path: dir } = created;
    expect(id).toBe("byok-only");
    expect(entriesOf(workspaceLayout(dir).dataDir)).toEqual(["workspace.json"]);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(machineDirOf(created), "preferences.json"),
          "utf8",
        ),
      ),
    ).toEqual({ developerMode: true });
    // Already in the current format and layout, so no sweep ever runs on
    // it, with an id of its own and a machine folder, named by its local
    // id, holding nothing but whose it is.
    const identity = readWorkspaceIdentity(dir);
    expect(identity.formatVersion).toBe(WORKSPACE_FORMAT_VERSION);
    expect(identity).toMatchObject({
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      legacyProjectsMigrated: true,
    });
    expect(identity.id).toMatch(/^[\dA-Z]{26}$/);
    expect(machineDirOf(created)).toBe(
      path.join(userDataDir, "machine", "byok-only"),
    );
    expect(entriesOf(machineDirOf(created))).toEqual([
      "owner.json",
      "preferences.json",
    ]);
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
    const created = createWorkspace({
      color: "blue",
      copySignInsFrom: from,
      developerMode: false,
      name: "Second account",
      userDataDir,
    });
    // Not the ChatGPT account: two holders of its rotating refresh token sign
    // each other out.
    expect(entriesOf(path.join(machineDirOf(created), "keys"))).toEqual([
      "providers.json",
      "session-dev.json",
    ]);
    expect(entriesOf(workspaceLayout(created.path).dataDir)).toEqual([
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
  it("lists strays, keeps entries it cannot reach, and marks the resolved one", () => {
    fs.mkdirSync(resolved.path);
    const { path: kept } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Kept",
      userDataDir,
    });
    const gone = path.join(userDataDir, "elsewhere", "unplugged");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [...registry.workspaces, { id: "unplugged", path: gone }],
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
      listed.map(
        ({ id, isReachable, isRegistered, isResolved, path: dir }) => ({
          dir,
          id,
          isReachable,
          isRegistered,
          isResolved,
        }),
      ),
    ).toEqual([
      {
        dir: resolved.path,
        id: "default",
        isReachable: true,
        isRegistered: true,
        isResolved: true,
      },
      {
        dir: kept,
        id: "kept",
        isReachable: true,
        isRegistered: true,
        isResolved: false,
      },
      {
        dir: gone,
        id: "unplugged",
        isReachable: false,
        isRegistered: true,
        isResolved: false,
      },
      {
        dir: stray,
        id: "stray",
        isReachable: true,
        isRegistered: false,
        isResolved: false,
      },
    ]);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "kept",
      "unplugged",
    ]);

    expect(registerStray({ dir: stray, resolved, userDataDir })).toBe(true);
    expect(readRegistry(userDataDir).workspaces.map((w) => w.id)).toEqual([
      "default",
      "kept",
      "unplugged",
      "stray",
    ]);
  });

  it("takes a folder spelled through a link, or in another case where the disk ignores it, for the one registered", () => {
    const { path: kept } = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Kept",
      userDataDir,
    });
    const link = path.join(userDataDir, "link-to-kept");
    fs.symlinkSync(kept, link);
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [
        ...registry.workspaces,
        { id: "kept-again", path: link },
        { id: "kept-shouting", path: kept.toUpperCase() },
      ],
    }));

    const ids = readRegistry(userDataDir).workspaces.map((w) => w.id);
    const foldsCase = fs.existsSync(kept.toUpperCase());
    expect(ids).toEqual(
      foldsCase ? ["default", "kept"] : ["default", "kept", "kept-shouting"],
    );
  });
});

describe("where a workspace's own data is", () => {
  it("finds the sign-ins in the machine folder, or the settings folder of one not yet moved", () => {
    const moved = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Moved",
      userDataDir,
    });
    expect(keysDirOf(userDataDir, moved)).toBe(
      path.join(machineDirOf(moved), "keys"),
    );
    expect(keysDirOf(userDataDir, resolved)).toBe(
      workspaceSettingsDirOf(resolved.path),
    );
  });

  it("reports a workspace another process holds open by its machine folder's mark", () => {
    const busy = createWorkspace({
      color: "gray",
      copySignInsFrom: null,
      developerMode: true,
      name: "Busy",
      userDataDir,
    });
    const other = startLiveProcess();
    try {
      fs.writeFileSync(
        path.join(machineDirOf(busy), "open.pid"),
        other.pid.toString(),
      );
      const heldBy = () =>
        listWorkspaces({ resolved, userDataDir }).find(
          (listing) => listing.path === busy.path,
        )?.openElsewhereBy;
      expect(heldBy()).toBe(other.pid);

      fs.rmSync(path.join(machineDirOf(busy), "open.pid"));
      markWorkspaceOpen(machineDirOf(busy));
      expect(heldBy()).toBeNull();
      releaseOpenMark(machineDirOf(busy));
    } finally {
      other.stop();
    }
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

  it.each([
    [[], false],
    [[".DS_Store"], false],
    [["report.pdf"], true],
    [["downloads"], true],
  ])(
    "removes the folder once its .instrument/ is gone and it holds %o: kept %s",
    (left, kept) => {
      const dir = path.join(userDataDir, "workspaces", "gone");
      fs.mkdirSync(dir, { recursive: true });
      for (const name of left) {
        fs.writeFileSync(path.join(dir, name), "");
      }
      removeFolderIfEmpty(dir);
      expect(fs.existsSync(dir)).toBe(kept);
    },
  );

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
    expect(fs.existsSync(workspaceLayout(dir).dataDir)).toBe(true);
  });
});
