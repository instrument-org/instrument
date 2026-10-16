import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanUpMachineData } from "./machine-cleanups";
import {
  defaultWorkspacePath,
  type ResolvedWorkspace,
  workspaceMachineDirOf,
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
