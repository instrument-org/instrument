import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultWorkspacePath,
  machineDirOwnedBy,
  markWorkspaceOpen,
  openElsewhereBy,
  readRegistry,
  readWorkspaceIdentity,
  releaseOpenMark,
  resolveWorkspace,
  settleWorkspace,
  updateRegistry,
  workspaceLayoutMarks,
  workspaceMachineDirOf,
  writeWorkspaceIdentity,
} from "./workspaces";

let userDataDir: string;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-"));
});

afterEach(() => {
  fs.rmSync(userDataDir, { force: true, recursive: true });
});

function registerWorkspace(id: string) {
  const dir = path.join(userDataDir, "workspaces", id);
  fs.mkdirSync(dir, { recursive: true });
  updateRegistry(userDataDir, (registry) => ({
    ...registry,
    workspaces: [...registry.workspaces, { id, path: dir }],
  }));
  return dir;
}

describe("resolveWorkspace", () => {
  it("opens the default workspace when there is no registry", () => {
    const { problems, workspace } = resolveWorkspace({
      now: 1,
      pin: undefined,
      userDataDir,
    });
    expect(problems).toEqual([]);
    expect(workspace).toEqual({
      id: "default",
      isDefault: true,
      path: defaultWorkspacePath(userDataDir),
      pinned: false,
    });
    expect(readRegistry(userDataDir)).toEqual({
      active: "default",
      workspaces: [
        {
          id: "default",
          lastOpenedAt: 1,
          path: defaultWorkspacePath(userDataDir),
        },
      ],
    });
  });

  it("opens the default workspace when the registry is not JSON", () => {
    fs.writeFileSync(path.join(userDataDir, "workspaces.json"), "{not json");
    expect(resolveWorkspace({ pin: undefined, userDataDir }).workspace.id).toBe(
      "default",
    );
  });

  it("opens the active workspace", () => {
    const dir = registerWorkspace("byok");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      active: "byok",
    }));
    expect(resolveWorkspace({ pin: undefined, userDataDir }).workspace).toEqual(
      { id: "byok", isDefault: false, path: dir, pinned: false },
    );
  });

  it("falls back to the default workspace when the active one's folder is gone", () => {
    const dir = registerWorkspace("byok");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      active: "byok",
    }));
    fs.rmSync(dir, { recursive: true });

    const { problems, workspace } = resolveWorkspace({
      pin: undefined,
      userDataDir,
    });
    expect(workspace.id).toBe("default");
    expect(problems).toHaveLength(1);
    expect(readRegistry(userDataDir).active).toBe("default");
  });

  it("lets a pin by id win over active without moving active", () => {
    registerWorkspace("byok");
    registerWorkspace("chatgpt");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      active: "byok",
    }));

    const { workspace } = resolveWorkspace({ pin: "chatgpt", userDataDir });
    expect(workspace).toMatchObject({ id: "chatgpt", pinned: true });
    expect(readRegistry(userDataDir).active).toBe("byok");
  });

  it("registers a pinned path nobody registered yet", () => {
    const dir = path.join(userDataDir, "elsewhere", "Clean Room");
    const { workspace } = resolveWorkspace({
      now: 5,
      pin: dir,
      userDataDir,
    });
    expect(workspace).toEqual({
      id: "clean-room",
      isDefault: false,
      path: dir,
      pinned: true,
    });
    expect(fs.existsSync(dir)).toBe(true);
    expect(readRegistry(userDataDir).workspaces).toContainEqual({
      id: "clean-room",
      lastOpenedAt: 5,
      path: dir,
    });
  });

  it("falls back for a pin naming no registered workspace", () => {
    const { problems, workspace } = resolveWorkspace({
      pin: "missing",
      userDataDir,
    });
    expect(workspace).toMatchObject({ id: "default", pinned: false });
    expect(problems).toHaveLength(1);
  });

  it("keeps another writer's entry when it records its own", () => {
    registerWorkspace("byok");
    resolveWorkspace({ pin: undefined, userDataDir });
    expect(
      readRegistry(userDataDir).workspaces.map((entry) => entry.id),
    ).toEqual(["default", "byok"]);
  });
});

describe("the registry on disk", () => {
  it("stores paths inside userData relative to it, so a copy opens its own", () => {
    registerWorkspace("byok");
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      active: "byok",
    }));
    const stored: unknown = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "workspaces.json"), "utf8"),
    );
    expect(stored).toHaveProperty("workspaces", [
      { id: "default", path: "workspace" },
      { id: "byok", path: path.join("workspaces", "byok") },
    ]);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-copy-"));
    fs.cpSync(userDataDir, copy, { recursive: true });
    try {
      expect(
        resolveWorkspace({ pin: undefined, userDataDir: copy }).workspace.path,
      ).toBe(path.join(copy, "workspaces", "byok"));
    } finally {
      fs.rmSync(copy, { force: true, recursive: true });
    }
  });

  it("drops one damaged entry and keeps the rest of the list", () => {
    registerWorkspace("byok");
    const file = path.join(userDataDir, "workspaces.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as {
      workspaces: unknown[];
    };
    stored.workspaces.push({ id: "broken", path: "" });
    fs.writeFileSync(file, JSON.stringify(stored));
    expect(
      readRegistry(userDataDir).workspaces.map((entry) => entry.id),
    ).toEqual(["default", "byok"]);
  });

  it("keeps an unreadable registry beside the one it writes", () => {
    fs.writeFileSync(path.join(userDataDir, "workspaces.json"), "{not json");
    resolveWorkspace({ pin: undefined, userDataDir });
    expect(
      fs
        .readdirSync(userDataDir)
        .some((name) => name.startsWith("workspaces.json.unreadable-")),
    ).toBe(true);
  });

  it("opens the default workspace when the registry cannot be written", () => {
    const blocked = path.join(userDataDir, "blocked");
    fs.writeFileSync(blocked, "a file where the userData folder would be");
    const { problems, workspace } = resolveWorkspace({
      pin: undefined,
      userDataDir: blocked,
    });
    expect(workspace.id).toBe("default");
    expect(problems).toHaveLength(1);
  });
});

describe("workspace ids", () => {
  const readJsonFile = (file: string): unknown =>
    JSON.parse(fs.readFileSync(file, "utf8"));

  function openDefault(newId: () => string) {
    const { workspace } = resolveWorkspace({ pin: undefined, userDataDir });
    return settleWorkspace({ newId, userDataDir, workspace });
  }

  it("names the machine folder by the local id, and mints the workspace's own id once", () => {
    const machineDir = openDefault(() => "01FIRST");

    expect(machineDir).toBe(workspaceMachineDirOf(userDataDir, "default"));
    expect(readWorkspaceIdentity(defaultWorkspacePath(userDataDir)).id).toBe(
      "01FIRST",
    );
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default", workspaceId: "01FIRST" },
    ]);
    expect(readJsonFile(path.join(machineDir, "owner.json"))).toEqual({
      workspaceId: "01FIRST",
    });

    expect(openDefault(() => "01SECOND")).toBe(machineDir);
    expect(readWorkspaceIdentity(defaultWorkspacePath(userDataDir)).id).toBe(
      "01FIRST",
    );
  });

  it("keeps the id through a boot's registry update", () => {
    openDefault(() => "01FIRST");
    resolveWorkspace({ pin: undefined, userDataDir });
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default", workspaceId: "01FIRST" },
    ]);
  });

  it("takes the id back from the registry when the workspace's own record lost it", () => {
    const machineDir = openDefault(() => "01FIRST");
    const dir = defaultWorkspacePath(userDataDir);
    writeWorkspaceIdentity(dir, {
      ...readWorkspaceIdentity(dir),
      id: undefined,
    });

    expect(openDefault(() => "01OTHER")).toBe(machineDir);
    expect(readWorkspaceIdentity(dir).id).toBe("01FIRST");
  });

  it("reads an id that could name a folder elsewhere as none", () => {
    const dir = defaultWorkspacePath(userDataDir);
    fs.mkdirSync(workspaceLayout(dir).dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceLayout(dir).dataDir, "workspace.json"),
      JSON.stringify({ id: "../../elsewhere", name: "Mine" }),
    );
    expect(readWorkspaceIdentity(dir).id).toBeUndefined();
    openDefault(() => "01MINTED");
    expect(readWorkspaceIdentity(dir)).toMatchObject({
      id: "01MINTED",
      name: "Mine",
    });
  });

  it("gives a copy of a registered workspace an id of its own", () => {
    const original = registerWorkspace("original");
    settleWorkspace({
      newId: () => "01ORIGINAL",
      userDataDir,
      workspace: { id: "original", path: original },
    });
    const copy = path.join(userDataDir, "elsewhere", "copy");
    fs.cpSync(original, copy, { recursive: true });
    const { workspace } = resolveWorkspace({ pin: copy, userDataDir });

    const machineDir = settleWorkspace({
      newId: () => "01COPY",
      userDataDir,
      workspace,
    });

    expect(readWorkspaceIdentity(copy).id).toBe("01COPY");
    expect(readWorkspaceIdentity(original).id).toBe("01ORIGINAL");
    expect(machineDir).toBe(workspaceMachineDirOf(userDataDir, "copy"));
  });

  it("keeps the local id and machine folder of a workspace whose folder moved", () => {
    const before = path.join(userDataDir, "elsewhere", "before");
    const first = resolveWorkspace({ pin: before, userDataDir }).workspace;
    const machineDir = settleWorkspace({
      newId: () => "01WANDERER",
      userDataDir,
      workspace: first,
    });
    const after = path.join(userDataDir, "elsewhere", "after");
    fs.renameSync(before, after);

    const second = resolveWorkspace({ pin: after, userDataDir }).workspace;

    expect(second.id).toBe(first.id);
    expect(settleWorkspace({ userDataDir, workspace: second })).toBe(
      machineDir,
    );
    expect(readRegistry(userDataDir).workspaces).toMatchObject([
      { id: "default" },
      { id: first.id, path: after, workspaceId: "01WANDERER" },
    ]);
  });

  it("sets aside a machine folder another workspace left under the same local id", () => {
    const machineDir = openDefault(() => "01GONE");
    fs.writeFileSync(path.join(machineDir, "keys.enc"), "the gone one's");
    // That workspace went, outside the app, and a new one took its place.
    fs.rmSync(defaultWorkspacePath(userDataDir), { recursive: true });
    fs.rmSync(path.join(userDataDir, "workspaces.json"));

    expect(openDefault(() => "01NEW")).toBe(machineDir);

    expect(fs.readdirSync(machineDir)).toEqual(["owner.json"]);
    expect(
      fs.readFileSync(`${machineDir}.01GONE${path.sep}keys.enc`, "utf8"),
    ).toBe("the gone one's");
  });

  it("keeps a copied application-data folder's machine data its own", () => {
    const machineDir = openDefault(() => "01ORIGINAL");
    fs.writeFileSync(path.join(machineDir, "keys.enc"), "mine");
    const clone = `${userDataDir}-clone`;
    fs.cpSync(userDataDir, clone, { recursive: true });
    try {
      const { workspace } = resolveWorkspace({
        pin: undefined,
        userDataDir: clone,
      });
      const cloned = settleWorkspace({
        newId: () => "01CLONE",
        userDataDir: clone,
        workspace,
      });
      expect(cloned).toBe(workspaceMachineDirOf(clone, "default"));
      expect(fs.readFileSync(path.join(cloned, "keys.enc"), "utf8")).toBe(
        "mine",
      );
      expect(machineDirOwnedBy(clone, workspace)).toBe(cloned);
    } finally {
      fs.rmSync(clone, { force: true, recursive: true });
    }
  });
});

describe("layout marks", () => {
  it("keeps the layout sweep's marks in workspace.json beside the rest", () => {
    const dir = defaultWorkspacePath(userDataDir);
    writeWorkspaceIdentity(dir, {
      color: "teal",
      createdBy: { kind: "person" },
      formatVersion: 1,
      name: "Mine",
      settingsVersion: 2,
    });
    const marks = workspaceLayoutMarks(dir);
    expect(marks.read()).toEqual({
      layoutVersion: undefined,
      legacyProjectsMigrated: undefined,
    });

    marks.write({ legacyProjectsMigrated: true });
    marks.write({ layoutVersion: 4 });

    expect(marks.read()).toEqual({
      layoutVersion: 4,
      legacyProjectsMigrated: true,
    });
    expect(readWorkspaceIdentity(dir)).toMatchObject({
      color: "teal",
      name: "Mine",
    });
  });
});

describe("open marks", () => {
  // The machine folder a workspace is marked open in.
  const markDir = () => workspaceMachineDirOf(userDataDir, "default");

  it("leaves a live process's mark alone", () => {
    fs.mkdirSync(markDir(), { recursive: true });
    const mark = path.join(markDir(), "open.pid");
    fs.writeFileSync(mark, process.ppid.toString());
    markWorkspaceOpen(markDir());
    expect(fs.readFileSync(mark, "utf8")).toBe(process.ppid.toString());
  });

  it("reports no other process for this one's own mark, or after release", () => {
    markWorkspaceOpen(markDir());
    expect(openElsewhereBy(markDir())).toBeNull();
    releaseOpenMark(markDir());
    expect(fs.existsSync(path.join(markDir(), "open.pid"))).toBe(false);
  });

  it("treats a pid that is not running as closed", () => {
    fs.mkdirSync(markDir(), { recursive: true });
    fs.writeFileSync(path.join(markDir(), "open.pid"), "999999");
    expect(openElsewhereBy(markDir())).toBeNull();
  });

  it("reports a live process holding the workspace", () => {
    fs.mkdirSync(markDir(), { recursive: true });
    fs.writeFileSync(path.join(markDir(), "open.pid"), process.ppid.toString());
    expect(openElsewhereBy(markDir())).toBe(process.ppid);
  });
});
