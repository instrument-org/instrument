import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectWorkspaceFolder } from "./workspace-refusal";
import {
  type ResolvedWorkspace,
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

  it("refuses a picked folder that is gone, or has lost its records", () => {
    const gone = path.join(root, "Gone");
    const emptied = path.join(root, "Emptied");
    fs.mkdirSync(emptied);
    for (const dir of [gone, emptied]) {
      expect(
        inspectWorkspaceFolder({ userDataDir, workspace: at(dir) }),
      ).toMatchObject({ kind: "unreadable", why: "missing" });
    }
  });

  it("makes again a folder in the app's own data, or one pinned", () => {
    expect(
      inspectWorkspaceFolder({
        userDataDir,
        workspace: at(path.join(userDataDir, "workspace")),
      }),
    ).toBeUndefined();
    expect(
      inspectWorkspaceFolder({
        userDataDir,
        workspace: at(path.join(root, "Clean room"), true),
      }),
    ).toBeUndefined();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses a folder it may not read",
    () => {
      const picked = path.join(root, "Instrument");
      writeWorkspaceIdentity(picked, identity(WORKSPACE_FORMAT_VERSION));
      fs.chmodSync(workspaceLayout(picked).dataDir, 0o000);
      try {
        expect(
          inspectWorkspaceFolder({ userDataDir, workspace: at(picked) }),
        ).toMatchObject({ kind: "unreadable", why: "denied" });
      } finally {
        fs.chmodSync(workspaceLayout(picked).dataDir, 0o755);
      }
    },
  );
});
