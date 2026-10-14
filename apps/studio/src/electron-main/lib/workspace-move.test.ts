import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  readMovedPaths,
  WORKSPACE_LAYOUT_VERSION,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_FORMAT_VERSION } from "./machine-data-migration";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import {
  checkMoveTarget,
  finishPendingMove,
  requestWorkspaceMove,
} from "./workspace-move";
import {
  readRegistry,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  resolveWorkspace,
  updateRegistry,
  workspaceMachineDirOf,
  writeWorkspaceIdentity,
} from "./workspaces";

const WORKSPACE_ID = "01K0000000000000000000MOVE";

let root: string;
let userDataDir: string;
let workspace: ResolvedWorkspace;
let picked: string;

/** A settled workspace's identity, as a build that ran every sweep leaves it. */
function settled(id = WORKSPACE_ID) {
  return {
    color: "gray" as const,
    createdBy: { kind: "person" as const },
    formatVersion: WORKSPACE_FORMAT_VERSION,
    id,
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    legacyProjectsMigrated: true,
    name: "Default",
    settingsVersion: CURRENT_SETTINGS_VERSION,
  };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-move-")));
  userDataDir = path.join(root, "Application Support", "Instrument");
  ({ workspace } = resolveWorkspace({ pin: undefined, userDataDir }));
  writeWorkspaceIdentity(workspace.path, settled());
  updateRegistry(userDataDir, (registry) => ({
    ...registry,
    workspaces: registry.workspaces.map((entry) => ({
      ...entry,
      workspaceId: WORKSPACE_ID,
    })),
  }));
  const chat = path.join(workspaceLayout(workspace.path).chatsDir, "c1");
  fs.mkdirSync(path.join(chat, "attachments"), { recursive: true });
  fs.writeFileSync(path.join(chat, "attachments", "sent.png"), "png");
  fs.mkdirSync(path.join(workspace.path, "downloads"));
  fs.writeFileSync(path.join(workspace.path, "downloads", "a.zip"), "zip");
  fs.writeFileSync(path.join(workspace.path, ".DS_Store"), "");
  picked = path.join(root, "Documents", "Instrument");
  fs.mkdirSync(picked, { recursive: true });
  fs.writeFileSync(path.join(picked, "report.pdf"), "pdf");
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

function check(target: string, at: ResolvedWorkspace = workspace) {
  return checkMoveTarget({ target, userDataDir, workspace: at });
}

describe("checkMoveTarget", () => {
  it("takes a folder with the person's own things in it", () => {
    expect(check(picked)).toEqual({ kind: "movable" });
  });

  it("offers to open a folder that already holds a workspace, never to move into it", () => {
    writeWorkspaceIdentity(picked, {
      ...settled("01K00000000000000000OTHER"),
      name: "Lab",
    });
    expect(check(picked)).toEqual({ kind: "workspace", name: "Lab" });
  });

  it.each([
    [
      "one holding a .instrument that is no workspace's",
      () => {
        fs.mkdirSync(path.join(picked, ".instrument"));
        return picked;
      },
      "taken",
    ],
    [
      "one inside the app's data",
      () => path.join(userDataDir, "elsewhere"),
      "app-data",
    ],
    ["one holding the app's data", () => root, "app-data"],
    ["the workspace's own folder", () => workspace.path, "current"],
    ["the home folder", () => os.homedir(), "home-or-drive"],
    ["the top of a disk", () => path.parse(root).root, "home-or-drive"],
    ["one that is not there", () => path.join(root, "nowhere"), "missing"],
    ["a file", () => path.join(picked, "report.pdf"), "missing"],
    ["a path that is not whole", () => "Documents/Instrument", "not-absolute"],
  ])("refuses %s", (_name, target, reason) => {
    const dir = target();
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (reason !== "missing" && reason !== "not-absolute") {
      fs.mkdirSync(dir, { recursive: true });
    }
    expect(check(dir)).toEqual({ kind: "refused", reason });
  });

  it("refuses a folder inside a picked workspace's own, or holding it", () => {
    const at = { ...workspace, path: picked };
    fs.mkdirSync(path.join(picked, "sub"));
    expect(check(path.join(picked, "sub"), at)).toEqual({
      kind: "refused",
      reason: "current",
    });
    expect(check(path.join(root, "Documents"), at)).toEqual({
      kind: "refused",
      reason: "current",
    });
  });

  it("refuses a folder holding or inside another workspace this computer knows", () => {
    const other = path.join(root, "Documents", "Other");
    fs.mkdirSync(path.join(other, "inside"), { recursive: true });
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [...registry.workspaces, { id: "other", path: other }],
    }));
    expect(check(path.join(root, "Documents"))).toEqual({
      kind: "refused",
      reason: "other-workspace",
    });
    expect(check(path.join(other, "inside"))).toEqual({
      kind: "refused",
      reason: "other-workspace",
    });
  });

  it("refuses to move a workspace whose sweeps have not finished, or one pinned", () => {
    writeWorkspaceIdentity(workspace.path, {
      ...settled(),
      layoutVersion: WORKSPACE_LAYOUT_VERSION - 1,
    });
    expect(check(picked)).toEqual({ kind: "refused", reason: "unfinished" });
    expect(check(picked, { ...workspace, pinned: true })).toEqual({
      kind: "refused",
      reason: "pinned",
    });
  });
});

describe("finishPendingMove", () => {
  const hide = vi.fn();
  const machineDir = () => workspaceMachineDirOf(userDataDir, "default");

  beforeEach(() => {
    hide.mockClear();
  });

  function finish() {
    return finishPendingMove({ hide, userDataDir, workspace });
  }

  it("moves the records and the person's files, and the entry follows", () => {
    const from = workspace.path;
    requestWorkspaceMove({ target: picked, userDataDir, workspace });

    const { workspace: moved } = finish();

    expect(moved.path).toBe(picked);
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readdirSync(picked).toSorted()).toEqual([
      ".instrument",
      "downloads",
      "report.pdf",
    ]);
    expect(
      fs.readFileSync(
        path.join(
          workspaceLayout(picked).chatsDir,
          "c1",
          "attachments",
          "sent.png",
        ),
        "utf8",
      ),
    ).toBe("png");
    expect(readWorkspaceIdentity(picked).id).toBe(WORKSPACE_ID);
    const [entry] = readRegistry(userDataDir).workspaces;
    expect(entry).toMatchObject({ id: "default", path: picked });
    expect(entry?.pendingMove).toBeUndefined();
    expect(readMovedPaths(machineDir())).toEqual([{ from, to: picked }]);
    expect(hide).toHaveBeenCalledWith(workspaceLayout(picked).dataDir);
    // The next launch opens it there, and has nothing to move.
    const again = resolveWorkspace({ pin: undefined, userDataDir });
    expect(again.workspace.path).toBe(picked);
    expect(
      finishPendingMove({ hide, userDataDir, workspace: again.workspace }),
    ).toEqual({ done: [], workspace: again.workspace });
  });

  it("finishes a copy that was whole but whose original was not removed yet", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    fs.cpSync(
      workspaceLayout(workspace.path).dataDir,
      workspaceLayout(picked).dataDir,
      { recursive: true },
    );

    finish();

    expect(fs.existsSync(workspaceLayout(workspace.path).dataDir)).toBe(false);
    expect(readWorkspaceIdentity(picked).id).toBe(WORKSPACE_ID);
    expect(readRegistry(userDataDir).workspaces[0]?.path).toBe(picked);
  });

  it("tidies the old folder after a launch that stopped once the entry moved", () => {
    const from = workspace.path;
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    fs.renameSync(
      workspaceLayout(from).dataDir,
      workspaceLayout(picked).dataDir,
    );
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: registry.workspaces.map((entry) => ({
        ...entry,
        path: picked,
      })),
    }));

    const { workspace: moved } = finishPendingMove({
      hide,
      userDataDir,
      workspace: { ...workspace, path: picked },
    });

    expect(moved.path).toBe(picked);
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.existsSync(path.join(picked, "downloads", "a.zip"))).toBe(true);
    expect(
      readRegistry(userDataDir).workspaces[0]?.pendingMove,
    ).toBeUndefined();
  });

  it("leaves everything where it was when the folder holds another workspace's records", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    writeWorkspaceIdentity(picked, settled("01K00000000000000000OTHER"));

    const { done, workspace: kept } = finish();

    expect(kept.path).toBe(workspace.path);
    expect(done.join("\n")).toContain("holds another workspace's records");
    expect(readWorkspaceIdentity(workspace.path).id).toBe(WORKSPACE_ID);
    expect(readRegistry(userDataDir).workspaces[0]).toMatchObject({
      path: workspace.path,
    });
    expect(
      readRegistry(userDataDir).workspaces[0]?.pendingMove,
    ).toBeUndefined();
  });

  it("waits for another process holding the workspace, and drops a copy it will not open", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    fs.cpSync(
      workspaceLayout(workspace.path).dataDir,
      workspaceLayout(picked).dataDir,
      { recursive: true },
    );
    fs.mkdirSync(machineDir(), { recursive: true });
    fs.writeFileSync(
      path.join(machineDir(), WORKSPACE_MACHINE_ENTRIES.openMark),
      process.ppid.toString(),
    );

    const { workspace: kept } = finish();

    expect(kept.path).toBe(workspace.path);
    expect(fs.existsSync(workspaceLayout(picked).dataDir)).toBe(false);
    expect(readWorkspaceIdentity(workspace.path).id).toBe(WORKSPACE_ID);
    expect(readRegistry(userDataDir).workspaces[0]?.pendingMove).toEqual({
      from: workspace.path,
      to: picked,
    });
  });
});

describe("resolveWorkspace after a move", () => {
  it("keeps a picked folder it cannot reach rather than opening another", () => {
    const gone = path.join(root, "Volumes", "Unplugged", "Instrument");
    updateRegistry(userDataDir, (registry) => ({
      active: "default",
      workspaces: registry.workspaces.map((entry) => ({
        ...entry,
        path: gone,
      })),
    }));
    expect(
      resolveWorkspace({ pin: undefined, userDataDir }).workspace,
    ).toMatchObject({
      id: "default",
      path: gone,
    });
  });
});
