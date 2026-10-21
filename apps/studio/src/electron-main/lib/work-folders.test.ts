import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { settleWorkFolders, workspaceLabel } from "./work-folders";
import { writeWorkspaceIdentity } from "./workspaces";

const base = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "work-folders-")),
);
afterAll(() => {
  fs.rmSync(base, { force: true, recursive: true });
});

let made = 0;
/** A home, this computer's folder and a workspace, each fresh. */
function computer(workspaceId = "01M50AD8JDN21N4B6XJ5GFYHJH") {
  const root = path.join(base, String(made++));
  const home = path.join(root, "home");
  const userDataDir = path.join(root, "Instrument (Dev)");
  const workspacePath = path.join(userDataDir, "workspace");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  writeWorkspaceIdentity(workspacePath, {
    color: "gray",
    createdBy: { kind: "person" },
    formatVersion: 2,
    id: workspaceId,
    name: "Default",
    settingsVersion: 0,
  });
  return {
    home,
    machineDir: path.join(userDataDir, "machine", "default"),
    userDataDir,
    workspace: { path: workspacePath },
  };
}

describe("workspaceLabel", () => {
  const userDataDir = path.join(base, "Instrument Preview (first-run)");
  it.each([
    [
      "the default workspace, by the app's data folder",
      path.join(userDataDir, "workspace"),
      "instrument-preview-first-run",
    ],
    [
      "one made from the dev panel, by both",
      path.join(userDataDir, "workspaces", "byok-only"),
      "instrument-preview-first-run-byok-only",
    ],
    [
      "a folder the person picked, by its name",
      path.join(base, "Documents", "Taxes & Receipts"),
      "taxes-receipts",
    ],
    ["a name with nothing to keep", path.join(base, "!!!"), "workspace"],
  ])("names %s", (_name, workspacePath, label) => {
    expect(workspaceLabel({ userDataDir, workspacePath })).toBe(label);
  });
});

describe("settleWorkFolders", () => {
  it("claims a readable folder in ~/.instrument/work and keeps it", () => {
    const at = computer();
    const first = settleWorkFolders(at);
    expect(path.relative(at.home, first.workFoldersDir)).toBe(
      path.join(".instrument", "work", "instrument-dev-yhjh"),
    );
    expect(fs.statSync(first.workFoldersDir).isDirectory()).toBe(true);
    // Renamed: the record keeps the name it settled.
    const renamed = path.join(path.dirname(at.workspace.path), "renamed");
    fs.renameSync(at.workspace.path, renamed);
    expect(
      settleWorkFolders({ ...at, workspace: { path: renamed } }).workFoldersDir,
    ).toBe(first.workFoldersDir);
  });

  it("takes another name where a second copy of the app has the same workspace", () => {
    const at = computer();
    const first = settleWorkFolders(at).workFoldersDir;
    const second = settleWorkFolders({
      ...at,
      machineDir: path.join(at.userDataDir, "machine", "other"),
      random: () => "k3f9",
    }).workFoldersDir;
    expect(path.basename(first)).toBe("instrument-dev-yhjh");
    expect(path.basename(second)).toBe("instrument-dev-k3f9");
  });
});
