import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultWorkspacePath,
  markWorkspaceOpen,
  openElsewhereBy,
  readRegistry,
  releaseOpenMark,
  resolveWorkspace,
  updateRegistry,
  workspacePrivateDir,
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
        { id: "default", lastOpenedAt: 1, path: defaultWorkspacePath(userDataDir) },
      ],
    });
  });

  it("opens the default workspace when the registry is not JSON", () => {
    fs.writeFileSync(path.join(userDataDir, "workspaces.json"), "{not json");
    expect(
      resolveWorkspace({ pin: undefined, userDataDir }).workspace.id,
    ).toBe("default");
  });

  it("opens the active workspace", () => {
    const dir = registerWorkspace("byok");
    updateRegistry(userDataDir, (registry) => ({ ...registry, active: "byok" }));
    expect(resolveWorkspace({ pin: undefined, userDataDir }).workspace).toEqual(
      { id: "byok", isDefault: false, path: dir, pinned: false },
    );
  });

  it("falls back to the default workspace when the active one's folder is gone", () => {
    const dir = registerWorkspace("byok");
    updateRegistry(userDataDir, (registry) => ({ ...registry, active: "byok" }));
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
    updateRegistry(userDataDir, (registry) => ({ ...registry, active: "byok" }));

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
    expect(readRegistry(userDataDir).workspaces.map((entry) => entry.id)).toEqual(
      ["default", "byok"],
    );
  });
});

describe("open marks", () => {
  it("reports no other process for this one's own mark, or after release", () => {
    const dir = defaultWorkspacePath(userDataDir);
    markWorkspaceOpen(dir);
    expect(openElsewhereBy(dir)).toBeNull();
    releaseOpenMark(dir);
    expect(fs.existsSync(path.join(workspacePrivateDir(dir), "open.pid"))).toBe(
      false,
    );
  });

  it("treats a pid that is not running as closed", () => {
    const dir = defaultWorkspacePath(userDataDir);
    fs.mkdirSync(workspacePrivateDir(dir), { recursive: true });
    fs.writeFileSync(path.join(workspacePrivateDir(dir), "open.pid"), "999999");
    expect(openElsewhereBy(dir)).toBeNull();
  });

  it("reports a live process holding the workspace", () => {
    const dir = defaultWorkspacePath(userDataDir);
    fs.mkdirSync(workspacePrivateDir(dir), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePrivateDir(dir), "open.pid"),
      process.ppid.toString(),
    );
    expect(openElsewhereBy(dir)).toBe(process.ppid);
  });
});
