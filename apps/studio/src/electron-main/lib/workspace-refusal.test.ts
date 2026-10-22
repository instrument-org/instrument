import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectWorkspaceFolder } from "./workspace-refusal";
import {
  type ResolvedWorkspace,
  updateRegistry,
  writeWorkspaceIdentity,
  WORKSPACE_FORMAT_VERSION,
} from "./workspaces";

let root: string;
let userDataDir: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refusal-")));
  userDataDir = path.join(root, "userData");
  fs.mkdirSync(userDataDir);
});

afterEach(() => {
  fs.chmodSync(root, 0o755);
  for (const dir of fs.readdirSync(root)) {
    fs.chmodSync(path.join(root, dir), 0o755);
  }
  fs.rmSync(root, { force: true, recursive: true });
});

function at(dir: string, pinned = false): ResolvedWorkspace {
  return { id: "default", isDefault: true, path: dir, pinned };
}

function identity(formatVersion: number) {
  return {
    color: "gray" as const,
    createdBy: { kind: "person" as const },
    formatVersion,
    name: "Default",
    settingsVersion: 2,
  };
}

describe("inspectWorkspaceFolder", () => {
  it("opens a folder in this build's format", () => {
    const picked = path.join(root, "Instrument");
    writeWorkspaceIdentity(picked, identity(WORKSPACE_FORMAT_VERSION));
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(picked) }),
    ).toBeUndefined();
  });

  it("refuses a folder a newer build made", () => {
    const picked = path.join(root, "Instrument");
    writeWorkspaceIdentity(picked, identity(WORKSPACE_FORMAT_VERSION + 1));
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(picked) }),
    ).toMatchObject({ kind: "newer" });
  });

  it("finds a picked folder lost when it is gone, or has lost its records", () => {
    const gone = path.join(root, "Gone");
    const emptied = path.join(root, "Emptied");
    fs.mkdirSync(emptied);
    for (const dir of [gone, emptied]) {
      expect(inspectWorkspaceFolder({ userDataDir, workspace: at(dir) })).toBe(
        "lost",
      );
    }
  });

  it("finds the default folder in the app's own data lost once it is gone", () => {
    const inAppData = path.join(userDataDir, "workspace");
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(inAppData) }),
    ).toBe("lost");
    // There with no workspace yet (1.x tasks), or 1.x settings to take in:
    // opened for the migrations.
    fs.mkdirSync(path.join(inAppData, "tasks"), { recursive: true });
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(inAppData) }),
    ).toBeUndefined();
    fs.rmSync(inAppData, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "preferences.json"), "{}");
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(inAppData) }),
    ).toBeUndefined();
  });

  it("makes again a folder pinned for the process", () => {
    expect(
      inspectWorkspaceFolder({
        userDataDir,
        workspace: at(path.join(root, "Clean room"), true),
      }),
    ).toBeUndefined();
  });

  it("finds a picked folder somewhere no workspace can be lost, but not one in the app's data or pinned", () => {
    const projects = path.join(root, "Projects");
    const picked = path.join(projects, "Instrument");
    const inAppData = path.join(userDataDir, "workspaces", "lab");
    for (const dir of [projects, picked, inAppData]) {
      writeWorkspaceIdentity(dir, identity(WORKSPACE_FORMAT_VERSION));
    }
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [
        ...registry.workspaces,
        { id: "projects", path: projects },
        { id: "picked", path: picked },
      ],
    }));
    const picking = { ...at(picked), id: "picked", isDefault: false };
    expect(inspectWorkspaceFolder({ userDataDir, workspace: picking })).toBe(
      "lost",
    );
    expect(
      inspectWorkspaceFolder({
        userDataDir,
        workspace: { ...picking, pinned: true },
      }),
    ).toBeUndefined();
    expect(
      inspectWorkspaceFolder({ userDataDir, workspace: at(inAppData) }),
    ).toBeUndefined();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "finds a folder it may not read lost",
    () => {
      const picked = path.join(root, "Instrument");
      writeWorkspaceIdentity(picked, identity(WORKSPACE_FORMAT_VERSION));
      fs.chmodSync(workspaceLayout(picked).dataDir, 0o000);
      try {
        expect(
          inspectWorkspaceFolder({ userDataDir, workspace: at(picked) }),
        ).toBe("lost");
      } finally {
        fs.chmodSync(workspaceLayout(picked).dataDir, 0o755);
      }
    },
  );
});
