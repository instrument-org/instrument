import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  readMovedPaths,
  WORKSPACE_LAYOUT_VERSION,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import childProcess, { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_FORMAT_VERSION } from "./machine-data-migration";
import { CURRENT_SETTINGS_VERSION } from "./settings-migration";
import {
  checkMoveTarget,
  finishPendingMove,
  refusalOfPlace,
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

/** Why `target` is refused by where it is, whether or not it is on this computer. */
function refusalOf(
  target: string,
  { temporaryDirs }: { temporaryDirs: string[] },
) {
  return refusalOfPlace({
    from: workspace.path,
    id: workspace.id,
    target,
    temporaryDirs,
    userDataDir,
  });
}

function check(target: string, at: ResolvedWorkspace = workspace) {
  return checkMoveTarget({
    target,
    temporaryDirs: [],
    userDataDir,
    workspace: at,
  });
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

  const home = (...names: string[]) => path.join(os.homedir(), ...names);
  it.each<{ name: string; reason: string; target: string }>([
    { name: "Documents itself", reason: "place", target: home("Documents") },
    { name: "Desktop itself", reason: "place", target: home("Desktop") },
    { name: "Downloads itself", reason: "place", target: home("Downloads") },
    ...(process.platform === "darwin"
      ? [
          {
            name: "iCloud Drive itself",
            reason: "place",
            target: home("Library", "Mobile Documents", "com~apple~CloudDocs"),
          },
          { name: "the apps' data", reason: "place", target: home("Library") },
          { name: "the folder of disks", reason: "place", target: "/Volumes" },
        ]
      : []),
    {
      name: "a hidden folder in the home folder",
      reason: "place",
      target: home(".instrument-work"),
    },
    { name: "the SSH folder", reason: "sign-ins", target: home(".ssh") },
    {
      name: "a folder inside a sign-in place",
      reason: "sign-ins",
      target: home(".config", "gh", "Instrument"),
    },
    {
      name: "a startup folder",
      reason: "sign-ins",
      target: home("Library", "LaunchAgents"),
    },
  ])("refuses $name", ({ reason, target }) => {
    expect(refusalOf(target, { temporaryDirs: [] })).toBe(reason);
  });

  it("refuses a temporary folder and one inside it, and takes a folder inside Documents", () => {
    const temporary = path.join(root, "tmp");
    fs.mkdirSync(path.join(temporary, "Instrument"), { recursive: true });
    expect(refusalOf(temporary, { temporaryDirs: [temporary] })).toBe(
      "temporary",
    );
    expect(
      refusalOf(path.join(temporary, "Instrument"), {
        temporaryDirs: [temporary],
      }),
    ).toBe("temporary");
    expect(
      refusalOf(path.join(os.homedir(), "Documents", "Instrument"), {
        temporaryDirs: [temporary],
      }),
    ).toBeUndefined();
  });

  it("refuses a folder whose .instrument is a link, even to a workspace's", () => {
    fs.symlinkSync(
      workspaceLayout(workspace.path).dataDir,
      path.join(picked, ".instrument"),
    );
    expect(check(picked)).toEqual({ kind: "refused", reason: "taken" });
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
  const registryFile = () => path.join(userDataDir, "workspaces.json");

  beforeEach(() => {
    hide.mockClear();
  });

  function finish() {
    return finishPendingMove({
      hide,
      temporaryDirs: [],
      userDataDir,
      workspace,
    });
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
      finishPendingMove({
        hide,
        temporaryDirs: [],
        userDataDir,
        workspace: again.workspace,
      }),
    ).toEqual({ done: [], workspace: again.workspace });
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
      temporaryDirs: [],
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

  it.each([
    [
      "another workspace's records",
      () => {
        writeWorkspaceIdentity(picked, settled("01K00000000000000000OTHER"));
      },
    ],
    [
      "a copy of this workspace the move did not make (synced from elsewhere, say)",
      () => {
        fs.cpSync(
          workspaceLayout(workspace.path).dataDir,
          workspaceLayout(picked).dataDir,
          { recursive: true },
        );
        fs.rmSync(path.join(workspaceLayout(picked).chatsDir, "c1"), {
          recursive: true,
        });
      },
    ],
  ])(
    "leaves everything where it was when the folder holds %s",
    (_name, plant) => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      plant();
      const target = listing(workspaceLayout(picked).dataDir);

      const { done, workspace: kept } = finish();

      expect(kept.path).toBe(workspace.path);
      expect(done.join("\n")).toContain("this move did not put there");
      expect(readWorkspaceIdentity(workspace.path).id).toBe(WORKSPACE_ID);
      expect(
        fs.existsSync(
          path.join(
            workspaceLayout(workspace.path).chatsDir,
            "c1",
            "attachments",
            "sent.png",
          ),
        ),
      ).toBe(true);
      expect(listing(workspaceLayout(picked).dataDir)).toEqual(target);
      expect(readRegistry(userDataDir).workspaces[0]).toMatchObject({
        path: workspace.path,
      });
      expect(
        readRegistry(userDataDir).workspaces[0]?.pendingMove,
      ).toBeUndefined();
    },
  );

  it.each([
    [
      "a .instrument linked to the original",
      () => {
        fs.symlinkSync(
          workspaceLayout(workspace.path).dataDir,
          workspaceLayout(picked).dataDir,
        );
      },
      "this move did not put there",
    ],
    [
      "the folder replaced by a link into the app's data",
      () => {
        fs.rmSync(picked, { recursive: true });
        const inside = path.join(userDataDir, "inside");
        fs.mkdirSync(inside);
        fs.symlinkSync(inside, picked);
      },
      "refuses now (app-data)",
    ],
    [
      "the folder replaced by a link to the workspace's own",
      () => {
        fs.rmSync(picked, { recursive: true });
        fs.symlinkSync(workspace.path, picked);
      },
      "refuses now (current)",
    ],
  ])(
    "checks the folder again when it moves, and leaves everything for %s",
    (_name, change, why) => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      change();

      const { done, workspace: kept } = finish();

      expect(kept.path).toBe(workspace.path);
      expect(done.join("\n")).toContain(why);
      expect(
        fs.readFileSync(
          path.join(
            workspaceLayout(workspace.path).chatsDir,
            "c1",
            "attachments",
            "sent.png",
          ),
          "utf8",
        ),
      ).toBe("png");
      expect(readRegistry(userDataDir).workspaces[0]).toMatchObject({
        path: workspace.path,
      });
      expect(
        readRegistry(userDataDir).workspaces[0]?.pendingMove,
      ).toBeUndefined();
    },
  );

  it("waits for a folder that is not there when it moves", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    fs.rmSync(picked, { recursive: true });

    const { done, workspace: kept } = finish();

    expect(kept.path).toBe(workspace.path);
    expect(done.join("\n")).toContain("not a folder now");
    expect(fs.existsSync(picked)).toBe(false);
    expect(readRegistry(userDataDir).workspaces[0]?.pendingMove).toEqual({
      from: workspace.path,
      to: picked,
    });
  });

  it("never sets aside records the target reaches as its own", () => {
    const from = workspace.path;
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    // The entry already names the target, which became a link to the
    // original folder before the launch that finishes the move.
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: registry.workspaces.map((entry) => ({
        ...entry,
        path: picked,
      })),
    }));
    fs.rmSync(picked, { recursive: true });
    fs.symlinkSync(from, picked);

    const { done } = finishPendingMove({
      hide,
      temporaryDirs: [],
      userDataDir,
      workspace: { ...workspace, path: picked },
    });

    expect(done.join("\n")).toContain("which is the target's own records");
    expect(readWorkspaceIdentity(from).id).toBe(WORKSPACE_ID);
    expect(fs.readdirSync(from).some((name) => name.includes(".moved-"))).toBe(
      false,
    );
  });

  it("waits for another process holding the workspace, touching nothing", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    holdOpen();

    const { workspace: kept } = finish();

    expect(kept.path).toBe(workspace.path);
    expect(fs.existsSync(workspaceLayout(picked).dataDir)).toBe(false);
    expect(readWorkspaceIdentity(workspace.path).id).toBe(WORKSPACE_ID);
    expect(readRegistry(userDataDir).workspaces[0]?.pendingMove).toEqual({
      from: workspace.path,
      to: picked,
    });
  });

  it("opens the whole copy a launch cut short made while another process holds the workspace, deleting nothing", () => {
    requestWorkspaceMove({ target: picked, userDataDir, workspace });
    crossVolumes();
    failWhen(
      "renameSync",
      (from, to) => to === registryFile() && commits(from),
    );
    finish();
    vi.restoreAllMocks();
    holdOpen();

    const { workspace: opened } = finish();

    expect(opened.path).toBe(picked);
    expect(readWorkspaceIdentity(workspace.path).id).toBe(WORKSPACE_ID);
    expect(readWorkspaceIdentity(picked).id).toBe(WORKSPACE_ID);
    expect(readRegistry(userDataDir).workspaces[0]?.path).toBe(workspace.path);
  });

  describe("two launches at once", () => {
    const lockFile = () =>
      path.join(machineDir(), WORKSPACE_MACHINE_ENTRIES.moveLock);

    it("opens where another launch moved the workspace after this one resolved it", () => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      const stale = resolveWorkspace({ pin: undefined, userDataDir }).workspace;
      finish();

      const { done, workspace: opened } = finishPendingMove({
        hide,
        temporaryDirs: [],
        userDataDir,
        workspace: stale,
      });

      expect(done).toEqual([]);
      expect(opened.path).toBe(picked);
    });

    it("waits for the launch making the move, then opens where it went", () => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      fs.mkdirSync(machineDir(), { recursive: true });
      // Another launch of this program holds the lock while it moves the
      // records and points the entry at the target, then lets go.
      const other = spawn(
        process.execPath,
        [
          "-e",
          `
          const fs = require("node:fs");
          const [lock, registry, from, to] = process.argv.slice(1);
          fs.writeFileSync(lock, String(process.pid));
          setTimeout(() => {
            fs.renameSync(from + "/.instrument", to + "/.instrument");
            const value = JSON.parse(fs.readFileSync(registry, "utf8"));
            for (const entry of value.workspaces) {
              if (entry.id === "default") {
                entry.path = to;
                delete entry.pendingMove;
              }
            }
            fs.writeFileSync(registry, JSON.stringify(value));
            fs.rmSync(lock);
          }, 400);
          `,
          lockFile(),
          registryFile(),
          workspace.path,
          picked,
        ],
        { stdio: "ignore" },
      );
      const exited = new Promise((resolve) => other.once("exit", resolve));
      waitFor(() => fs.existsSync(lockFile()));

      const { done, workspace: opened } = finish();

      expect(done).toEqual([]);
      expect(opened.path).toBe(picked);
      expect(readWorkspaceIdentity(picked).id).toBe(WORKSPACE_ID);
      return exited;
    });

    it("takes over a lock a launch left when it ended", () => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      fs.mkdirSync(machineDir(), { recursive: true });
      const ended = spawnSync(process.execPath, ["-e", ""]).pid;
      fs.writeFileSync(lockFile(), String(ended));

      const { workspace: moved } = finish();

      expect(moved.path).toBe(picked);
      expect(fs.existsSync(lockFile())).toBe(false);
    });

    it("marks the workspace open before it lets another launch in", () => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });

      finish();

      expect(
        fs.readFileSync(
          path.join(machineDir(), WORKSPACE_MACHINE_ENTRIES.openMark),
          "utf8",
        ),
      ).toBe(process.pid.toString());
    });
  });

  describe("cut short or failing at any step", () => {
    /** The records every launch must find whole, with what each holds. */
    let records: Map<string, string>;

    beforeEach(() => {
      records = new Map([
        ["chats/c1/attachments/sent.png", "png"],
        ["chats/c1/chat.db", "c1"],
        ["chats/c2/chat.db", "c2"],
        ["skills/mine/SKILL.md", "mine"],
        ["memory/likes.md", "tea"],
      ]);
      for (const [file, contents] of records) {
        write(
          path.join(workspaceLayout(workspace.path).dataDir, file),
          contents,
        );
      }
    });

    /** A launch: resolve, finish the move, check what it opens, and work in it. */
    function launch(n: number) {
      const resolved = resolveWorkspace({ pin: undefined, userDataDir });
      const result = finishPendingMove({
        hide,
        temporaryDirs: [],
        userDataDir,
        workspace: resolved.workspace,
      });
      const opened = result.workspace.path;
      const dataDir = workspaceLayout(opened).dataDir;
      expect([workspace.path, picked]).toContain(opened);
      expect(fs.lstatSync(dataDir).isDirectory()).toBe(true);
      for (const [file, contents] of records) {
        expect(
          fs.readFileSync(path.join(dataDir, file), "utf8"),
          `${file} in what launch ${n.toString()} opened`,
        ).toBe(contents);
      }
      // What the person does in this launch lands in the copy it opened.
      const file = `chats/n${n.toString()}/chat.db`;
      write(path.join(dataDir, file), `launch ${n.toString()}`);
      records.set(file, `launch ${n.toString()}`);
      return { done: result.done, opened };
    }

    const original = () => workspaceLayout(workspace.path).dataDir;
    const isAside = (entry: string) => entry.includes(".instrument.moved-");

    it.each<{
      fault: () => void;
      launches: number;
      name: string;
      volumes: "across" | "one";
    }>([
      {
        fault: () => {
          failWhen("copy", (from) => from === original(), "part-way");
        },
        launches: 1,
        name: "the copy stops part-way",
        volumes: "across",
      },
      {
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) => to === registryFile() && marks(from),
          );
        },
        launches: 1,
        name: "the copy's mark cannot be recorded",
        volumes: "across",
      },
      {
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) =>
              from.includes(".instrument.partial-") &&
              to === workspaceLayout(picked).dataDir,
          );
        },
        launches: 1,
        name: "the whole copy cannot be renamed into place",
        volumes: "across",
      },
      {
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) =>
              from === original() && to === workspaceLayout(picked).dataDir,
          );
        },
        launches: 1,
        name: "the records cannot be renamed to the target",
        volumes: "one",
      },
      ...(["one", "across"] as const).map((volumes) => ({
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) => to === registryFile() && commits(from),
          );
        },
        launches: 1,
        name: "the entry cannot be pointed at the target",
        volumes,
      })),
      {
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) => from === original() && isAside(to),
          );
        },
        launches: 2,
        name: "the original cannot be renamed aside",
        volumes: "across",
      },
      {
        fault: () => {
          failWhen("rmSync", (entry) => isAside(entry), "part-way");
        },
        launches: 2,
        name: "the original's delete stops part-way",
        volumes: "across",
      },
      ...(["one", "across"] as const).map((volumes) => ({
        fault: () => {
          failWhen(
            "renameSync",
            (from) => from === path.join(workspace.path, "downloads"),
          );
        },
        launches: 1,
        name: "the person's files cannot be moved",
        volumes,
      })),
      {
        fault: () => {
          failWhen("renameSync", (_from, to) =>
            to.endsWith("moved-paths.json"),
          );
        },
        launches: 1,
        name: "the moved paths cannot be recorded",
        volumes: "across",
      },
      {
        fault: () => {
          failWhen(
            "renameSync",
            (from, to) => to === registryFile() && clears(from),
          );
        },
        launches: 1,
        name: "the pending move cannot be cleared",
        volumes: "across",
      },
    ])(
      "never opens a partial copy or loses a file when $name ($volumes volume)",
      ({ fault, launches, volumes }) => {
        requestWorkspaceMove({ target: picked, userDataDir, workspace });
        const opened: string[] = [];
        for (let n = 1; n <= launches + 2; n++) {
          vi.restoreAllMocks();
          if (volumes === "across") {
            crossVolumes();
          }
          if (n <= launches) {
            fault();
          }
          const { done, opened: at } = launch(n);
          opened.push(at);
          // The fault happened, and the launch said so.
          expect(done.join("\n").includes("injected")).toBe(n <= launches);
        }
        vi.restoreAllMocks();

        // Once a launch opened the target, none went back to the original.
        expect(opened.slice(opened.indexOf(picked))).not.toContain(
          workspace.path,
        );
        expect(opened.at(-1)).toBe(picked);
        const [entry] = readRegistry(userDataDir).workspaces;
        expect(entry?.path).toBe(picked);
        expect(entry?.pendingMove).toBeUndefined();
        expect(fs.existsSync(workspace.path)).toBe(false);
        expect(fs.readdirSync(picked).toSorted()).toEqual([
          ".instrument",
          "downloads",
          "report.pdf",
        ]);
      },
    );

    it("keeps the move pending while the original's aside cannot be deleted, and never reads it", () => {
      requestWorkspaceMove({ target: picked, userDataDir, workspace });
      crossVolumes();
      failWhen("rmSync", (entry) => isAside(entry), "part-way");

      const { done } = launch(1);

      expect(done.join("\n")).toContain("the next launch tries again");
      expect(
        readRegistry(userDataDir).workspaces[0]?.pendingMove,
      ).toMatchObject({
        leftAside: true,
      });
      expect(fs.readdirSync(workspace.path).filter(isAside)).toHaveLength(1);
      // The old folder is not swept again on the launch that retries.
      write(path.join(workspace.path, "later.txt"), "later");
      vi.restoreAllMocks();

      launch(2);

      expect(fs.readdirSync(workspace.path)).toEqual(["later.txt"]);
      expect(fs.existsSync(path.join(picked, "later.txt"))).toBe(false);
      expect(
        readRegistry(userDataDir).workspaces[0]?.pendingMove,
      ).toBeUndefined();
    });
  });

  /** As if the workspace and the picked folder were on two volumes. */
  function crossVolumes() {
    failWhen(
      "renameSync",
      (from, to) =>
        from === workspaceLayout(workspace.path).dataDir &&
        to === workspaceLayout(picked).dataDir,
      "EXDEV",
    );
  }

  /** The default workspace's entry as a registry write from `temporary` leaves it. */
  function written(temporary: string) {
    const registry = JSON.parse(fs.readFileSync(temporary, "utf8")) as {
      workspaces: {
        path: string;
        pendingMove?: { copyMark?: string };
      }[];
    };
    return registry.workspaces[0];
  }

  /** Whether the registry write from `temporary` points the entry at the target. */
  function commits(temporary: string) {
    return (
      written(temporary)?.path === picked &&
      readRegistry(userDataDir).workspaces[0]?.path !== picked
    );
  }

  /** Whether the registry write from `temporary` records the copy's mark. */
  function marks(temporary: string) {
    return (
      written(temporary)?.pendingMove?.copyMark !== undefined &&
      readRegistry(userDataDir).workspaces[0]?.pendingMove?.copyMark ===
        undefined
    );
  }

  /** Whether the registry write from `temporary` drops the pending move. */
  function clears(temporary: string) {
    return (
      written(temporary)?.pendingMove === undefined &&
      readRegistry(userDataDir).workspaces[0]?.pendingMove !== undefined
    );
  }

  /** Mark the workspace open in a live process of this program. */
  function holdOpen() {
    fs.mkdirSync(machineDir(), { recursive: true });
    fs.writeFileSync(
      path.join(machineDir(), WORKSPACE_MACHINE_ENTRIES.openMark),
      process.ppid.toString(),
    );
  }
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

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Every file under a folder, sorted. */
function listing(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

/** `copy` is the copy across volumes: ditto on macOS, `fs.cpSync` elsewhere. */
type FaultyMethod = "copy" | "renameSync" | "rmSync";

/** How an injected fault fails: as a move across volumes, part of the way, or outright. */
type Failure = "EXDEV" | "part-way" | "refused";

const real = {
  cpSync: fs.cpSync,
  execFileSync: childProcess.execFileSync,
  renameSync: fs.renameSync,
  rmSync: fs.rmSync,
};
let faults: {
  failure: Failure;
  method: FaultyMethod;
  when: (from: string, to: string) => boolean;
}[] = [];

/**
 * Make the next calls of `method` that `when` picks fail, until
 * `vi.restoreAllMocks`. `part-way` copies or deletes a little first.
 */
function failWhen(
  method: FaultyMethod,
  when: (from: string, to: string) => boolean,
  failure: Failure = "refused",
) {
  if (!vi.isMockFunction(method === "copy" ? fs.cpSync : fs[method])) {
    faults = faults.filter((fault) => fault.method !== method);
    spyOn(method);
  }
  faults.push({ failure, method, when });
}

function spyOn(method: FaultyMethod) {
  const fault = (from: string, to = "") =>
    faults.find(
      (candidate) => candidate.method === method && candidate.when(from, to),
    )?.failure;
  const injected = (failure: Failure) =>
    Object.assign(new Error(`injected ${failure}`), {
      code: failure === "EXDEV" ? "EXDEV" : "EIO",
    });
  switch (method) {
    case "copy": {
      vi.spyOn(childProcess, "execFileSync").mockImplementation(
        (file, args, options) => {
          const [from = "", to = ""] = args ?? [];
          const failure = fault(from, to);
          const copied = real.execFileSync(file, args, options);
          if (failure === undefined) {
            return copied;
          }
          // ditto copies whole or not at all, so part of the way is the
          // copy with all but its first few files gone.
          for (const extra of listing(to).slice(4)) {
            fs.unlinkSync(path.join(to, extra));
          }
          throw injected(failure);
        },
      );
      vi.spyOn(fs, "cpSync").mockImplementation((from, to, options) => {
        const failure = fault(String(from), String(to));
        if (failure === undefined) {
          real.cpSync(from, to, options);
          return;
        }
        let copied = 0;
        real.cpSync(from, to, {
          ...options,
          filter: () => {
            copied++;
            if (copied > 4) {
              throw injected(failure);
            }
            return true;
          },
        });
      });
      break;
    }
    case "renameSync": {
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        const failure = fault(String(from), String(to));
        if (failure !== undefined) {
          throw injected(failure);
        }
        real.renameSync(from, to);
      });
      break;
    }
    case "rmSync": {
      vi.spyOn(fs, "rmSync").mockImplementation((entry, options) => {
        const failure = fault(String(entry));
        if (failure === undefined) {
          real.rmSync(entry, options);
          return;
        }
        const [first] = listing(String(entry));
        if (first !== undefined) {
          fs.unlinkSync(path.join(String(entry), first));
        }
        throw injected(failure);
      });
      break;
    }
  }
}

/** Wait, blocking, until `ready` answers true, for up to five seconds. */
function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
