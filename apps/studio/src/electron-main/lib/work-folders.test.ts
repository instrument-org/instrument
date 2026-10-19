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

function write(file: string, text = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
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

  it("moves the work folders an earlier build kept, and the paths stored into them", () => {
    const at = computer();
    const earlier = path.join(at.machineDir, "work");
    write(path.join(earlier, "2026-10-13-chat", "report.md"), "report");
    write(path.join(earlier, "2026-10-14-other", "a", "b.txt"), "b");
    const kept = path.join(earlier, "2026-10-13-chat", "report.md");
    write(
      path.join(at.machineDir, "permissions.json"),
      JSON.stringify({
        folders: [{ addedAt: 0, level: "allow", path: kept }],
      }),
    );

    const { done, workFoldersDir } = settleWorkFolders(at);

    expect(fs.existsSync(earlier)).toBe(false);
    expect(
      fs.readFileSync(
        path.join(workFoldersDir, "2026-10-13-chat", "report.md"),
        "utf8",
      ),
    ).toBe("report");
    expect(
      fs.readFileSync(
        path.join(workFoldersDir, "2026-10-14-other", "a", "b.txt"),
        "utf8",
      ),
    ).toBe("b");
    expect(
      fs.readFileSync(path.join(at.machineDir, "permissions.json"), "utf8"),
    ).toContain(
      JSON.stringify(path.join(workFoldersDir, "2026-10-13-chat", "report.md")),
    );
    expect(done.join("\n")).toContain("moved 2 work folder(s)");
  });

  it("finishes a move a launch cut short, merging into what it moved", () => {
    const at = computer();
    const { workFoldersDir } = settleWorkFolders(at);
    // As a launch cut short leaves it: one chat moved, the record not yet
    // saying so, the rest still where it was.
    const record = path.join(at.machineDir, "work-folders.json");
    fs.writeFileSync(
      record,
      JSON.stringify({ name: path.basename(workFoldersDir) }),
    );
    write(path.join(workFoldersDir, "2026-10-13-chat", "one.md"), "1");
    write(path.join(at.machineDir, "work", "2026-10-13-chat", "two.md"), "2");
    write(path.join(at.machineDir, "work", "2026-10-14-other", "three.md"));

    settleWorkFolders(at);

    expect(
      fs.readdirSync(path.join(workFoldersDir, "2026-10-13-chat")).toSorted(),
    ).toEqual(["one.md", "two.md"]);
    expect(fs.existsSync(path.join(workFoldersDir, "2026-10-14-other"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(at.machineDir, "work"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toMatchObject({
      moved: true,
    });
  });

  it("leaves a file whose place is taken where it was", () => {
    const at = computer();
    const { workFoldersDir } = settleWorkFolders(at);
    fs.writeFileSync(
      path.join(at.machineDir, "work-folders.json"),
      JSON.stringify({ name: path.basename(workFoldersDir) }),
    );
    write(path.join(workFoldersDir, "c", "same.md"), "new");
    write(path.join(at.machineDir, "work", "c", "same.md"), "old");

    const { done } = settleWorkFolders(at);

    expect(
      fs.readFileSync(path.join(workFoldersDir, "c", "same.md"), "utf8"),
    ).toBe("new");
    expect(
      fs.readFileSync(path.join(at.machineDir, "work", "c", "same.md"), "utf8"),
    ).toBe("old");
    expect(done.join("\n")).toContain("is there already");
  });
});
