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

import { cleanUpMachineData } from "./machine-cleanups";
import {
  defaultWorkspacePath,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
  workspaceMachineDirOf,
  writeWorkspaceIdentity,
} from "./workspaces";

let userDataDir: string;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "machine-cleanups-"));
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

const machineDir = () => workspaceMachineDirOf(userDataDir, "default");

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

/** Run the cleanups as a boot does, and the lines they wrote. */
function clean(): string[] {
  return cleanUpMachineData({
    machineDir: machineDir(),
    userDataDir,
    workspace: workspace(),
  });
}

describe("the browser homes kept per chat", () => {
  const home = () => path.join(machineDir(), "browser", "agent-browser-home");

  function seed() {
    write(path.join(home(), "cha_one", "config.json"), "{}");
    write(path.join(home(), "cha_one", "instrument-provider.mjs"), "plugin");
    write(path.join(home(), "cha_two", "config.json"), "{}");
    write(path.join(home(), "config.json"), "{}");
  }

  it("removes every folder below the one home the workspace now shares", () => {
    seed();

    const done = clean();

    expect(tree(home())).toEqual(["config.json"]);
    expect(done).toContain(
      `removed 2 browser homes kept per chat in ${home()}`,
    );
  });

  it("has nothing left to say on the boot after", () => {
    seed();
    clean();

    expect(clean()).toEqual([]);
    expect(tree(home())).toEqual(["config.json"]);
  });

  it("says nothing on an install that never had one", () => {
    expect(clean()).toEqual([]);
  });
});

describe("the files no build reads any more", () => {
  const dataDir = () =>
    path.join(defaultWorkspacePath(userDataDir), ".instrument");

  /** An install whose migrations have all finished, with every dead file in it. */
  function seedDead() {
    writeWorkspaceIdentity(defaultWorkspacePath(userDataDir), {
      color: "gray",
      createdBy: { kind: "person" },
      formatVersion: 1,
      name: "Default",
      settingsVersion: 2,
    });
    write(path.join(userDataDir, "machine-preferences.json"), "{}");
    write(path.join(userDataDir, "machine-state.json"), "{}");
    for (const name of [
      "app-state.json",
      "favorites.json",
      "features.json",
      "preferences.json",
      "window-state.json",
      "chatgpt-plan.json",
      "chatgpt-plan.json.enc",
      "instrument-install-4321.sh",
    ]) {
      write(path.join(userDataDir, name));
    }
    write(path.join(machineDir(), "keys", "chatgpt-plan.json.enc"));
    write(path.join(dataDir(), "workspace.db"));
    write(path.join(dataDir(), "migrations.json"));
    // Live stores at the same level, which stay.
    write(path.join(userDataDir, "notices.json"));
    write(path.join(machineDir(), "keys", "providers.json.enc"));
  }

  it("removes them, and leaves the stores beside them", () => {
    seedDead();

    const done = clean();

    expect(
      fs
        .readdirSync(userDataDir)
        .filter((name) => name.endsWith(".json") || name.endsWith(".sh"))
        .toSorted(),
    ).toEqual([
      "machine-preferences.json",
      "machine-state.json",
      "notices.json",
    ]);
    expect(tree(path.join(machineDir(), "keys"))).toEqual([
      "providers.json.enc",
    ]);
    expect(tree(dataDir())).toEqual(["workspace.json"]);
    expect(done).toContain("removed 11 file(s) nothing reads");
  });

  it("has nothing left to say on the boot after", () => {
    seedDead();
    clean();

    expect(clean()).toEqual([]);
  });

  // They are the only copy of what they say until both migrations have read
  // them, so a workspace partway through keeps them.
  it("keeps the root settings while the workspace's migrations have not finished", () => {
    seedDead();
    writeWorkspaceIdentity(defaultWorkspacePath(userDataDir), {
      ...readWorkspaceIdentity(defaultWorkspacePath(userDataDir)),
      formatVersion: 0,
    });

    clean();

    expect(fs.existsSync(path.join(userDataDir, "preferences.json"))).toBe(
      true,
    );
    // What never belonged to one workspace's take-in still goes.
    expect(fs.existsSync(path.join(userDataDir, "chatgpt-plan.json"))).toBe(
      false,
    );
  });

  it("leaves the root settings for another workspace, which never read them", () => {
    seedDead();

    cleanUpMachineData({
      machineDir: workspaceMachineDirOf(userDataDir, "other"),
      userDataDir,
      workspace: {
        id: "other",
        isDefault: false,
        path: path.join(userDataDir, "workspaces", "other"),
        pinned: false,
      },
    });

    expect(fs.existsSync(path.join(userDataDir, "preferences.json"))).toBe(
      true,
    );
  });
});

describe("the preferences kept in the workspace", () => {
  const dataDir = () =>
    path.join(defaultWorkspacePath(userDataDir), ".instrument");
  const moved = () => path.join(machineDir(), "preferences.json");

  it("moves them into this computer's folder", () => {
    write(
      path.join(dataDir(), "preferences.json"),
      JSON.stringify({ theme: "dark" }),
    );

    const done = clean();

    expect(JSON.parse(fs.readFileSync(moved(), "utf8"))).toEqual({
      theme: "dark",
    });
    expect(fs.existsSync(path.join(dataDir(), "preferences.json"))).toBe(false);
    expect(done).toContain(
      `moved ${path.join(dataDir(), "preferences.json")} to ${moved()}`,
    );
  });

  // Another computer sharing the workspace put the file back, or never took
  // it out: what this computer already chose stays.
  it("keeps this computer's own and drops the workspace's", () => {
    write(moved(), JSON.stringify({ theme: "light" }));
    write(
      path.join(dataDir(), "preferences.json"),
      JSON.stringify({ theme: "dark" }),
    );

    clean();

    expect(JSON.parse(fs.readFileSync(moved(), "utf8"))).toEqual({
      theme: "light",
    });
    expect(fs.existsSync(path.join(dataDir(), "preferences.json"))).toBe(false);
  });

  it("has nothing left to say on the boot after", () => {
    write(path.join(dataDir(), "preferences.json"), "{}");
    clean();

    expect(clean()).toEqual([]);
  });
});

describe("the feature flags kept in a file of their own", () => {
  const dataDir = () =>
    path.join(defaultWorkspacePath(userDataDir), ".instrument");
  const preferences = () =>
    JSON.parse(
      fs.readFileSync(path.join(machineDir(), "preferences.json"), "utf8"),
    ) as Record<string, unknown>;

  it("merges them into the preferences and takes the file away", () => {
    write(
      path.join(dataDir(), "features.json"),
      JSON.stringify({ context_ring: true, retired_flag: true }),
    );
    write(
      path.join(dataDir(), "preferences.json"),
      JSON.stringify({ theme: "dark" }),
    );

    const done = clean();

    expect(preferences()).toEqual({
      features: { context_ring: true },
      theme: "dark",
    });
    expect(fs.existsSync(path.join(dataDir(), "features.json"))).toBe(false);
    expect(done).toContain(
      `merged 1 feature flag into ${path.join(machineDir(), "preferences.json")}`,
    );
  });

  it("writes the preferences for a workspace that had none", () => {
    write(
      path.join(dataDir(), "features.json"),
      JSON.stringify({ context_ring: true }),
    );

    clean();

    expect(preferences()).toEqual({ features: { context_ring: true } });
  });

  it("has nothing left to say on the boot after", () => {
    write(
      path.join(dataDir(), "features.json"),
      JSON.stringify({ context_ring: true }),
    );
    clean();

    expect(clean()).toEqual([]);
    expect(preferences()).toEqual({ features: { context_ring: true } });
  });
});

describe("the browser's own downloads folder", () => {
  const dir = () => path.join(defaultWorkspacePath(userDataDir), "downloads");

  it("removes it once it is empty", () => {
    fs.mkdirSync(dir(), { recursive: true });

    const done = clean();

    expect(fs.existsSync(dir())).toBe(false);
    expect(done).toContain(
      `removed ${dir()}, which the browser no longer saves into`,
    );
  });

  it("has nothing left to say on the boot after", () => {
    fs.mkdirSync(dir(), { recursive: true });
    clean();

    expect(clean()).toEqual([]);
  });

  it("leaves the files the person downloaded into it", () => {
    write(path.join(dir(), "report.pdf"), "pdf");

    expect(clean()).toEqual([]);
    expect(tree(dir())).toEqual(["report.pdf"]);
  });

  // The browser only ever made it in the app's own data; in a picked folder
  // it is the person's, and on a disk that ignores case `Downloads` is it.
  it("leaves the empty Downloads folder of a picked workspace", () => {
    const picked = fs.mkdtempSync(path.join(os.tmpdir(), "picked-"));
    onTestFinished(() => {
      fs.rmSync(picked, { force: true, recursive: true });
    });
    fs.mkdirSync(path.join(picked, "downloads"));

    const done = cleanUpMachineData({
      machineDir: machineDir(),
      userDataDir,
      workspace: { id: "w1", isDefault: false, path: picked, pinned: true },
    });

    expect(done).toEqual([]);
    expect(fs.existsSync(path.join(picked, "downloads"))).toBe(true);
  });
});

describe("the Claude sign-in at the top of this computer's data", () => {
  const atRoot = () => path.join(userDataDir, "claude-account");
  const inWorkspace = () => path.join(machineDir(), "claude-account");

  it("moves it in beside the workspace's other keys", () => {
    write(path.join(atRoot(), ".credentials.json"), "the sign-in");

    const done = clean();

    expect(tree(inWorkspace())).toEqual([".credentials.json"]);
    expect(
      fs.readFileSync(path.join(inWorkspace(), ".credentials.json"), "utf8"),
    ).toBe("the sign-in");
    expect(fs.existsSync(atRoot())).toBe(false);
    expect(done).toContain(
      `moved the Claude sign-in from ${atRoot()} to ${inWorkspace()}`,
    );
  });

  it("has nothing left to say on the boot after", () => {
    write(path.join(atRoot(), ".credentials.json"), "the sign-in");
    clean();

    expect(clean()).toEqual([]);
    expect(tree(inWorkspace())).toEqual([".credentials.json"]);
  });

  it("leaves the workspace's own sign-in alone, and the root folder where it is", () => {
    write(path.join(atRoot(), ".credentials.json"), "the older sign-in");
    write(path.join(inWorkspace(), ".credentials.json"), "this workspace's");

    expect(clean()).toEqual([]);
    expect(
      fs.readFileSync(path.join(inWorkspace(), ".credentials.json"), "utf8"),
    ).toBe("this workspace's");
    expect(fs.existsSync(atRoot())).toBe(true);
  });

  it("leaves it for another workspace, which never kept it there", () => {
    write(path.join(atRoot(), ".credentials.json"), "the sign-in");

    const done = cleanUpMachineData({
      machineDir: workspaceMachineDirOf(userDataDir, "other"),
      userDataDir,
      workspace: {
        id: "other",
        isDefault: false,
        path: path.join(userDataDir, "workspaces", "other"),
        pinned: false,
      },
    });

    expect(done).toEqual([]);
    expect(fs.existsSync(atRoot())).toBe(true);
  });
});
