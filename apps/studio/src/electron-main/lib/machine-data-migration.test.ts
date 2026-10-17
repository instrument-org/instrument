import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { startLiveProcess } from "../../tests/live-process";
import { moveMachineData } from "./machine-data-migration";
import { migrateWorkspaceSettings } from "./settings-migration";
import {
  defaultWorkspacePath,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  settleWorkspace,
  updateRegistry,
  WORKSPACE_FORMAT_VERSION,
  workspaceMachineDirOf,
  writeWorkspaceIdentity,
} from "./workspaces";

let userDataDir: string;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "machine-data-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(userDataDir, { force: true, recursive: true });
});

const workspace = (): ResolvedWorkspace => ({
  id: "default",
  isDefault: true,
  path: defaultWorkspacePath(userDataDir),
  pinned: false,
});

function write(file: string, contents = path.basename(file)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Every file under `dir`, by its path from there. */
function tree(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

const indexName = (workspacePath: string) =>
  `${createHash("sha256").update(workspacePath).digest("hex").slice(0, 16)}.db`;

/** A 2.0 beta's default workspace, everything the app kept in it, and the index beside it. */
function seedBeta() {
  const root = defaultWorkspacePath(userDataDir);
  const data = path.join(root, ".instrument");
  const settings = path.join(data, "settings");
  writeWorkspaceIdentity(root, {
    color: "gray",
    createdBy: { kind: "person" },
    formatVersion: 0,
    name: "Default",
    settingsVersion: 2,
  });
  for (const name of [
    "app-connections.json",
    "app-credentials.json.enc",
    "app-oauth.json.enc",
    "bookmarks.json",
    "chatgpt-account.json.enc",
    "chatgpt-plan.json.enc",
    "downloads.json",
    "external-app-links.json",
    "features.json",
    "layout.json",
    "preferences.json",
    "providers.json.enc",
    "session-dev.json",
    "session.json.enc",
    "something-new.json.enc",
    "state.json",
    "view.json",
    "window-state.json",
  ]) {
    write(path.join(settings, name), `${name} as it was`);
  }
  write(path.join(data, "app-session", "Cookies"));
  write(path.join(data, "browser-session", "Local Storage", "leveldb"));
  write(path.join(data, "history.db"));
  write(path.join(data, "history.db-wal"));
  write(path.join(data, "page-thumbnails", "a.jpg"));
  write(path.join(data, "window.json"), "{}");
  write(path.join(data, "open.pid"), "999999");
  write(path.join(data, ".layout-version"), "3");
  write(path.join(data, ".legacy-projects-migrated"), "");
  write(path.join(data, "window", ".instrument", "chat.db"));
  write(path.join(data, "ai-usage.db"));
  write(path.join(root, "permissions.json"), "{}");
  write(path.join(root, ".app-servers", "notion", "package.json"), "{}");
  write(path.join(root, "chats", "2026-10-01-chat", ".instrument", "chat.db"));
  write(path.join(userDataDir, "indexes", indexName(root)));
  write(path.join(userDataDir, "indexes", "0123456789abcdef.db"));
}

describe("moveMachineData", () => {
  it("moves a beta workspace's machine data out and keeps what travels in it", () => {
    seedBeta();

    const { done, machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    const root = defaultWorkspacePath(userDataDir);
    const identity = readWorkspaceIdentity(root);
    expect(identity).toMatchObject({
      formatVersion: 1,
      layoutVersion: 3,
      legacyProjectsMigrated: true,
      name: "Default",
      settingsVersion: 2,
    });
    // Named by the local id; the workspace's own id is a ULID in its record
    // and the registry's.
    expect(machineDir).toBe(workspaceMachineDirOf(userDataDir, "default"));
    expect(identity.id).toMatch(/^[\dA-Z]{26}$/);
    expect(tree(machineDir)).toEqual(
      [
        "app-servers/notion/package.json",
        "browser/app-session/Cookies",
        "browser/browser-session/Local Storage/leveldb",
        "browser/downloads.json",
        "browser/external-app-links.json",
        "browser/history.db",
        "browser/history.db-wal",
        "browser/page-thumbnails/a.jpg",
        "keys/app-connections.json",
        "keys/app-credentials.json.enc",
        "keys/app-oauth.json.enc",
        "keys/chatgpt-account.json.enc",
        "keys/chatgpt-plan.json.enc",
        "keys/providers.json.enc",
        "keys/session-dev.json",
        "keys/session.json.enc",
        "keys/something-new.json.enc",
        "owner.json",
        "permissions.json",
        "state.json",
        "window/layout.json",
        "window/view.json",
        "window/window-state.json",
      ].map((file) => file.replaceAll("/", path.sep)),
    );
    // Moved, not made again: each secret is the file that was there.
    expect(
      fs.readFileSync(
        path.join(machineDir, "keys", "providers.json.enc"),
        "utf8",
      ),
    ).toBe("providers.json.enc as it was");
    expect(tree(root)).toEqual(
      [
        ".instrument/ai-usage.db",
        ".instrument/bookmarks.json",
        ".instrument/features.json",
        ".instrument/preferences.json",
        ".instrument/window/.instrument/chat.db",
        ".instrument/workspace.json",
        "chats/2026-10-01-chat/.instrument/chat.db",
      ].map((file) => file.replaceAll("/", path.sep)),
    );
    // Nothing reads an index from the shared folder.
    expect(fs.existsSync(path.join(userDataDir, "indexes"))).toBe(false);
    expect(done).toContain(
      `workspace at format version 1, machine data in ${machineDir}`,
    );
  });

  // A folder the person picked, or pinned, that no build made a workspace
  // of: what is at its top level is theirs, whatever it is called.
  it("leaves a newly picked folder's own permissions.json and .app-servers where they are", () => {
    const picked = path.join(userDataDir, "Documents", "Projects");
    write(path.join(picked, "permissions.json"), "the person's");
    write(path.join(picked, ".app-servers", "notes.txt"), "the person's");
    const pickedWorkspace: ResolvedWorkspace = {
      id: "projects",
      isDefault: false,
      path: picked,
      pinned: true,
    };

    // As a boot runs them, the settings migration first.
    migrateWorkspaceSettings({
      packaged: false,
      userDataDir,
      workspace: pickedWorkspace,
    });
    const { machineDir } = moveMachineData({
      userDataDir,
      workspace: pickedWorkspace,
    });

    expect(tree(picked)).toEqual([
      path.join(".app-servers", "notes.txt"),
      path.join(".instrument", "workspace.json"),
      "permissions.json",
    ]);
    expect(tree(machineDir)).not.toContain("permissions.json");
    // A folder no build made a workspace of holds nothing in an older
    // format, so the settings take-in starts it at this one.
    expect(readWorkspaceIdentity(picked).formatVersion).toBe(
      WORKSPACE_FORMAT_VERSION,
    );
  });

  it("does nothing on the boots after", () => {
    seedBeta();
    const first = moveMachineData({ userDataDir, workspace: workspace() });
    const before = tree(userDataDir);

    const second = moveMachineData({ userDataDir, workspace: workspace() });

    expect(second).toEqual({ done: [], machineDir: first.machineDir });
    expect(tree(userDataDir)).toEqual(before);
  });

  it("starts a fresh install with an id and nothing to move", () => {
    writeWorkspaceIdentity(defaultWorkspacePath(userDataDir), {
      color: "gray",
      createdBy: { kind: "person" },
      formatVersion: 0,
      name: "Default",
      settingsVersion: 2,
    });

    const { done, machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    expect(done).toEqual([
      `workspace at format version 1, machine data in ${machineDir}`,
    ]);
    expect(tree(machineDir)).toEqual(["owner.json"]);
  });

  it("keeps what is already at a new place and leaves the old one where it was", () => {
    seedBeta();
    const kept = path.join(
      settleWorkspace({ userDataDir, workspace: workspace() }),
      "keys",
      "providers.json.enc",
    );
    write(kept, "already here");

    const { done } = moveMachineData({ userDataDir, workspace: workspace() });

    const old = path.join(
      defaultWorkspacePath(userDataDir),
      ".instrument",
      "settings",
      "providers.json.enc",
    );
    expect(fs.readFileSync(kept, "utf8")).toBe("already here");
    expect(fs.readFileSync(old, "utf8")).toBe("providers.json.enc as it was");
    expect(done).toContain(`left ${old}: ${kept} is already there`);
    expect(
      readWorkspaceIdentity(defaultWorkspacePath(userDataDir)).formatVersion,
    ).toBe(1);
  });

  it("leaves what it cannot move, and on the next boot puts it over the defaults written in its place", () => {
    seedBeta();
    const machineDir = settleWorkspace({ userDataDir, workspace: workspace() });
    // A file where the browser folder goes, so nothing can move into it.
    write(path.join(machineDir, "browser"), "in the way");

    const first = moveMachineData({ userDataDir, workspace: workspace() });

    const old = path.join(
      defaultWorkspacePath(userDataDir),
      ".instrument",
      "settings",
      "downloads.json",
    );
    expect(fs.readFileSync(old, "utf8")).toBe("downloads.json as it was");
    expect(
      first.done.some((step) => step.startsWith(`could not move ${old}`)),
    ).toBe(true);
    expect(
      readWorkspaceIdentity(defaultWorkspacePath(userDataDir)).formatVersion,
    ).toBe(0);

    // The app opened anyway, and its downloads store wrote its default.
    fs.rmSync(path.join(machineDir, "browser"));
    write(path.join(machineDir, "browser", "downloads.json"), "the default");

    moveMachineData({ userDataDir, workspace: workspace() });

    expect(
      fs.readFileSync(
        path.join(machineDir, "browser", "downloads.json"),
        "utf8",
      ),
    ).toBe("downloads.json as it was");
    expect(fs.existsSync(old)).toBe(false);
    expect(
      readWorkspaceIdentity(defaultWorkspacePath(userDataDir)).formatVersion,
    ).toBe(1);
    expect(tree(machineDir)).not.toContain(".move-unfinished");
  });

  it("copies a folder it cannot rename across volumes, then removes the original", () => {
    seedBeta();
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      // Only the move to the machine folder: the original's rename aside
      // before its delete stays on its own volume.
      if (
        String(from).endsWith(`${path.sep}app-session`) &&
        !String(to).includes(".moved-")
      ) {
        throw Object.assign(new Error("cross-device link not permitted"), {
          code: "EXDEV",
        });
      }
      rename(from, to);
    });
    // ditto on macOS, which carries extended attributes; Node's copy elsewhere.
    const copy =
      process.platform === "darwin"
        ? vi.spyOn(childProcess, "execFileSync")
        : vi.spyOn(fs, "cpSync");

    const { machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    expect(copy).toHaveBeenCalledOnce();
    expect(tree(path.join(machineDir, "browser", "app-session"))).toEqual([
      "Cookies",
    ]);
    expect(
      fs.existsSync(
        path.join(
          defaultWorkspacePath(userDataDir),
          ".instrument",
          "app-session",
        ),
      ),
    ).toBe(false);
    expect(
      fs
        .readdirSync(path.join(machineDir, "browser"))
        .some((name) => name.includes(".partial-")),
    ).toBe(false);
    expect(
      fs
        .readdirSync(
          path.join(defaultWorkspacePath(userDataDir), ".instrument"),
        )
        .some((name) => name.includes(".moved-")),
    ).toBe(false);
  });

  it("leaves a link, and what is in a folder that is one, where it is", () => {
    seedBeta();
    const root = defaultWorkspacePath(userDataDir);
    const outside = path.join(userDataDir, "outside");
    write(path.join(outside, "settings", "providers.json.enc"), "theirs");
    write(path.join(outside, "permissions.json"), "theirs");
    const settings = path.join(root, ".instrument", "settings");
    fs.rmSync(settings, { recursive: true });
    fs.symlinkSync(path.join(outside, "settings"), settings);
    fs.rmSync(path.join(root, "permissions.json"));
    fs.symlinkSync(
      path.join(outside, "permissions.json"),
      path.join(root, "permissions.json"),
    );

    const { done, machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    expect(tree(outside)).toEqual([
      "permissions.json",
      path.join("settings", "providers.json.enc"),
    ]);
    expect(
      fs.existsSync(path.join(machineDir, "keys", "providers.json.enc")),
    ).toBe(false);
    expect(fs.existsSync(path.join(machineDir, "permissions.json"))).toBe(
      false,
    );
    expect(done).toContain(
      `left ${path.join(settings, "providers.json.enc")}: it is a link, or in one`,
    );
    expect(done).toContain(
      `left ${path.join(root, "permissions.json")}: it is a link, or in one`,
    );
    // The rest still moved.
    expect(tree(path.join(machineDir, "browser", "app-session"))).toEqual([
      "Cookies",
    ]);
  });

  it("removes the shared index folder while another workspace still has its data to move", () => {
    seedBeta();
    const other: ResolvedWorkspace = {
      id: "other",
      isDefault: false,
      path: path.join(userDataDir, "workspaces", "other"),
      pinned: false,
    };
    writeWorkspaceIdentity(other.path, {
      color: "gray",
      createdBy: { kind: "person" },
      formatVersion: 0,
      name: "Other",
      settingsVersion: 2,
    });
    updateRegistry(userDataDir, (registry) => ({
      ...registry,
      workspaces: [...registry.workspaces, { id: "other", path: other.path }],
    }));
    write(path.join(userDataDir, "indexes", indexName(other.path)), "other's");

    moveMachineData({ userDataDir, workspace: workspace() });

    expect(fs.existsSync(path.join(userDataDir, "indexes"))).toBe(false);
    const { machineDir } = moveMachineData({ userDataDir, workspace: other });
    expect(fs.existsSync(path.join(machineDir, "index"))).toBe(false);
  });

  describe("the key stores a development build left at the root", () => {
    const LONG_AGO = new Date("2026-01-01");
    const LATER = new Date("2027-01-01");

    /** A root file, last written at `when`. */
    function writeAtRoot(name: string, when: Date) {
      const file = path.join(userDataDir, name);
      write(file, `${name} at the root`);
      fs.utimesSync(file, when, when);
    }

    function seedRoot() {
      // Taken in, and no newer than the workspace's copy.
      writeAtRoot("session-dev.json", LONG_AGO);
      writeAtRoot("providers.json.enc", LONG_AGO);
      // Never taken in: the workspace holds no store of the name.
      writeAtRoot("providers.json", LONG_AGO);
      // Written after the take-in by something else.
      writeAtRoot("app-connections.json", LATER);
      // Not a key store.
      writeAtRoot("features.json", LONG_AGO);
    }

    it("removes the copies the workspace's keys hold, once they hold them", () => {
      seedBeta();
      seedRoot();

      const { done } = moveMachineData({ userDataDir, workspace: workspace() });

      expect(
        fs
          .readdirSync(userDataDir)
          .filter((name) => name.endsWith(".json") || name.endsWith(".enc"))
          .toSorted(),
      ).toEqual([
        "app-connections.json",
        "features.json",
        "providers.json",
        "workspaces.json",
      ]);
      expect(done).toContain(
        "removed the root copy of session-dev.json, which the keys hold",
      );
    });

    it("removes them on a later boot of a workspace an earlier build moved", () => {
      seedBeta();
      moveMachineData({ userDataDir, workspace: workspace() });
      seedRoot();

      moveMachineData({ userDataDir, workspace: workspace() });

      expect(fs.existsSync(path.join(userDataDir, "session-dev.json"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(userDataDir, "providers.json"))).toBe(
        true,
      );
    });

    it("leaves them while the move has not finished", () => {
      seedBeta();
      seedRoot();
      const machineDir = settleWorkspace({
        userDataDir,
        workspace: workspace(),
      });
      write(path.join(machineDir, "browser"), "in the way");

      moveMachineData({ userDataDir, workspace: workspace() });

      expect(fs.existsSync(path.join(userDataDir, "session-dev.json"))).toBe(
        true,
      );
    });

    it("leaves them for another workspace, which never took them in", () => {
      const other: ResolvedWorkspace = {
        id: "other",
        isDefault: false,
        path: path.join(userDataDir, "workspaces", "other"),
        pinned: false,
      };
      write(
        path.join(
          workspaceMachineDirOf(userDataDir, "other"),
          "keys",
          "session-dev.json",
        ),
      );
      seedRoot();

      moveMachineData({ userDataDir, workspace: other });

      expect(fs.existsSync(path.join(userDataDir, "session-dev.json"))).toBe(
        true,
      );
    });
  });

  it("leaves everything where it is while an older build has the workspace open, and moves it on the boot after", () => {
    seedBeta();
    const root = defaultWorkspacePath(userDataDir);
    const mark = path.join(root, ".instrument", "open.pid");
    const older = startLiveProcess();
    onTestFinished(older.stop);
    write(mark, older.pid.toString());
    const before = tree(root);

    const { done, machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    expect(done).toEqual([
      `left the machine data where it is while process ${older.pid.toString()} has the workspace open`,
    ]);
    expect(tree(root)).toEqual(before);
    expect(readWorkspaceIdentity(root).formatVersion).toBe(0);

    // This boot's stores wrote their defaults; the older build then quit.
    write(path.join(machineDir, "keys", "providers.json.enc"), "the default");
    fs.rmSync(mark);

    moveMachineData({ userDataDir, workspace: workspace() });

    expect(
      fs.readFileSync(
        path.join(machineDir, "keys", "providers.json.enc"),
        "utf8",
      ),
    ).toBe("providers.json.enc as it was");
    expect(readWorkspaceIdentity(root).formatVersion).toBe(1);
  });

  // The chat conversion runs later in the same launch and raises the format
  // past this migration's whether or not the move finished, so the format
  // cannot be what says this is done.
  it("moves what a failed launch left even after the conversion raised the format", () => {
    seedBeta();
    const root = defaultWorkspacePath(userDataDir);
    const old = path.join(root, ".instrument", "settings", "providers.json.enc");
    const rename = fs.renameSync.bind(fs);
    const once = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((from, to) => {
        if (String(from) === old) {
          once.mockImplementation(rename);
          throw Object.assign(new Error("in use"), { code: "EACCES" });
        }
        rename(from, to);
      });

    const { machineDir } = moveMachineData({
      userDataDir,
      workspace: workspace(),
    });

    expect(fs.existsSync(old)).toBe(true);
    expect(readWorkspaceIdentity(root).formatVersion).toBe(0);

    // What the chat conversion writes once it has finished, which says
    // nothing about the move above.
    writeWorkspaceIdentity(root, {
      ...readWorkspaceIdentity(root),
      chatRecordsConverted: true,
      formatVersion: WORKSPACE_FORMAT_VERSION,
    });

    moveMachineData({ userDataDir, workspace: workspace() });

    expect(
      fs.readFileSync(
        path.join(machineDir, "keys", "providers.json.enc"),
        "utf8",
      ),
    ).toBe("providers.json.enc as it was");
    expect(fs.existsSync(old)).toBe(false);
    // Raised by the conversion and left there: a finished move never puts
    // the format back.
    expect(readWorkspaceIdentity(root).formatVersion).toBe(
      WORKSPACE_FORMAT_VERSION,
    );
    expect(tree(machineDir)).not.toContain(".move-unfinished");
  });
});
