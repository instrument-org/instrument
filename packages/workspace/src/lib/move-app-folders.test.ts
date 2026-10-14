import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import { moveAppFoldersIntoDataDir } from "./move-app-folders";
import { readMovedPaths, remapMovedPath } from "./moved-paths";

const workspace = withTempDir("move-app-folders-workspace");
const machine = withTempDir("move-app-folders-machine");
const outside = withTempDir("move-app-folders-outside");

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function at(...segments: string[]) {
  return path.join(workspace.path, ...segments);
}

function move() {
  return moveAppFoldersIntoDataDir({
    machineDir: machine.path,
    rootDir: workspace.path,
  });
}

/** Every file under a folder, relative to it, sorted. */
function listing(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

describe("moveAppFoldersIntoDataDir", () => {
  it.each([
    ["a chat's records", ["chats", "2026-10-01-chat", "chat.db"]],
    [
      "what a chat was sent",
      ["chats", "2026-10-01-chat", "attachments", "a.png"],
    ],
    ["a draft's words", ["drafts", "01M4H5NJW7PF0CWW7J3T51Q1MT", "draft.md"]],
    ["a topic's instructions", ["topics", "Home", "instructions.md"]],
    ["a workspace skill", ["skills", "brief", "SKILL.md"]],
    ["an app's setup", ["apps", "linear", "app.json"]],
    ["a memory", ["memory", "no-stevia.md"]],
    ["what a migration set aside", [".pre-chats", "empty-tasks", "t", "x"]],
  ])("moves %s into the workspace's .instrument/", (_case, segments) => {
    write(at(...segments), "kept");

    const result = move();

    expect(result.failed).toBe(0);
    expect(fs.existsSync(at(segments[0] ?? ""))).toBe(false);
    expect(fs.readFileSync(at(".instrument", ...segments), "utf8")).toBe(
      "kept",
    );
  });

  it("leaves the workspace's top level holding only .instrument/ and the person's own folders", () => {
    for (const name of ["chats/c", "drafts/d", "topics/T", "skills/s"]) {
      write(at(name, "file"));
    }
    write(at(".instrument", "workspace.json"), "{}");
    write(at("Reports", "q3.pdf"));

    move();

    expect(fs.readdirSync(workspace.path).toSorted()).toEqual([
      ".instrument",
      "Reports",
    ]);
  });

  it("merges into a folder already in .instrument/, leaving what clashes where it was", () => {
    write(at("drafts", "a", "draft.md"), "moved");
    write(at("drafts", "b", "draft.md"), "older");
    write(at(".instrument", "drafts", "b", "draft.md"), "newer");

    const result = move();

    // Counted, so the sweep runs again rather than leaving it for good.
    expect(result.failed).toBe(1);
    expect(result.done).toContain(
      `left ${at("drafts", "b", "draft.md")}: ${at(".instrument", "drafts", "b", "draft.md")} is already there`,
    );
    expect(listing(at(".instrument", "drafts"))).toEqual([
      path.join("a", "draft.md"),
      path.join("b", "draft.md"),
    ]);
    expect(
      fs.readFileSync(at(".instrument", "drafts", "b", "draft.md"), "utf8"),
    ).toBe("newer");
    expect(listing(at("drafts"))).toEqual([path.join("b", "draft.md")]);
  });

  it("leaves a file where a folder was expected", () => {
    write(at("memory"), "not a folder");

    const result = move();

    expect(result.done).toEqual([`left ${at("memory")}: it is not a folder`]);
    expect(fs.readFileSync(at("memory"), "utf8")).toBe("not a folder");
    expect(readMovedPaths(machine.path)).toEqual([]);
  });

  it("never merges into a link in its place in .instrument/, or moves one at the top", () => {
    write(at("drafts", "a", "draft.md"), "mine");
    write(path.join(outside.path, "drafts", "b", "draft.md"), "theirs");
    write(path.join(outside.path, "topics", "T", "instructions.md"), "theirs");
    fs.mkdirSync(at(".instrument"), { recursive: true });
    fs.symlinkSync(
      path.join(outside.path, "drafts"),
      at(".instrument", "drafts"),
    );
    fs.symlinkSync(path.join(outside.path, "topics"), at("topics"));

    const result = move();

    expect(result.failed).toBe(1);
    expect(result.done).toEqual([
      `left ${at("topics")}: it is not a folder`,
      `left ${at("drafts")}: ${at(".instrument", "drafts")} is already there`,
    ]);
    expect(listing(path.join(outside.path))).toEqual([
      path.join("drafts", "b", "draft.md"),
      path.join("topics", "T", "instructions.md"),
    ]);
    expect(listing(at("drafts"))).toEqual([path.join("a", "draft.md")]);
    expect(fs.lstatSync(at("topics")).isSymbolicLink()).toBe(true);
  });

  it("does nothing on a second run, and records nothing where nothing moved", () => {
    write(at("chats", "c", "chat.db"));
    move();
    const moves = readMovedPaths(machine.path);

    expect(move()).toEqual({ done: [], failed: 0 });
    expect(readMovedPaths(machine.path)).toEqual(moves);
  });

  it("records each move, so a path stored before is read where it went", () => {
    write(at("chats", "c", "attachments", "a.png"));
    write(at("skills", "brief", "SKILL.md"));
    write(at("topics", "Home", "instructions.md"));

    move();

    expect(readMovedPaths(machine.path)).toEqual([
      { from: at("chats"), to: at(".instrument", "chats") },
      { from: at("skills"), to: at(".instrument", "skills") },
      { from: at("topics"), to: at(".instrument", "topics") },
    ]);
    expect(
      remapMovedPath(
        at("chats", "c", "attachments", "a.png"),
        readMovedPaths(machine.path),
      ),
    ).toBe(at(".instrument", "chats", "c", "attachments", "a.png"));
  });
});
