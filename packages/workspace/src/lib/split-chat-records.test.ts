import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workspaceLayout } from "./workspace-layout";
import { AbsolutePathSchema, RelativePathSchema } from "../schemas/paths";
import { readMovedPaths } from "./moved-paths";
import { resolvePathWithinChatDir } from "./resolve-path-within-chat-dir";
import { splitChatRecords } from "./split-chat-records";
import { withTempDir } from "../test/helpers/temp-dir";

const workspace = withTempDir("split-chat-records-workspace");
const machine = withTempDir("split-chat-records-machine");

const CHAT = "2026-10-01-beta";

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function recordDir(id = CHAT) {
  return path.join(workspaceLayout(workspace.path).chatsDir, id);
}

function workDir(id = CHAT) {
  return path.join(machine.path, "work", id);
}

/** Every file under a folder, and every empty folder with a slash, sorted. */
function listing(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  const walk = (at: string, relative: string) => {
    const entries = fs.readdirSync(at, { withFileTypes: true });
    if (entries.length === 0 && relative !== "") {
      found.push(`${relative}/`);
    }
    for (const entry of entries) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(at, entry.name), child);
      } else {
        found.push(child);
      }
    }
  };
  walk(dir, "");
  return found.toSorted();
}

/** A chat folder as a 2.0 beta left one: records inside, work beside them. */
function writeBetaChat(id = CHAT) {
  const dir = recordDir(id);
  write(path.join(dir, ".instrument", "chat.db"), "db");
  write(path.join(dir, ".instrument", "chat.db-wal"), "wal");
  write(
    path.join(dir, ".instrument", "settings.json"),
    `{"chatSessionId":"ses_01K0000000000000000000000"}`,
  );
  write(path.join(dir, ".instrument", "agent-browser-home", "config.json"));
  write(path.join(dir, "work", "report.md"), "report");
  write(path.join(dir, "work", "handoff-notes.md"), "notes");
  write(path.join(dir, "attachments", "a.png"), "png");
  write(path.join(dir, ".tool-output", "x.txt"), "spill");
  write(path.join(dir, "package.json"), "{}");
  write(path.join(dir, "pnpm-workspace.yaml"));
  write(path.join(dir, "pnpm-lock.yaml"));
  write(path.join(dir, ".gitignore"));
  write(path.join(dir, "node_modules", "left-pad", "index.js"));
  write(path.join(dir, ".venv", "bin", "python"));
  write(path.join(dir, ".tmp", "scratch"));
  write(path.join(dir, "tasks", "old-task", ".instrument", "task.db"), "old");
  write(path.join(dir, "tasks", "old-task", "work", "old.md"), "old work");
  write(path.join(dir, "tasks", "old-task", "node_modules", "x", "index.js"));
  write(path.join(dir, "tasks", "records-only", ".instrument", "task.db"));
}

function split() {
  return splitChatRecords({
    machineDir: machine.path,
    rootDir: workspace.path,
  });
}

describe("splitChatRecords", () => {
  it("keeps the records where they were and moves the work to the machine", () => {
    writeBetaChat();
    write(
      path.join(
        workspace.path,
        ".instrument",
        "window",
        ".instrument",
        "chat.db",
      ),
      "tabs",
    );
    write(
      path.join(workspace.path, ".instrument", "window", "downloads", "a.pdf"),
    );

    const result = split();

    expect(result.failed).toBe(0);
    expect(result.done).toEqual([
      expect.stringMatching(new RegExp(`^${CHAT}: .*, with its work in `)),
      expect.stringMatching(/^window: /),
    ]);
    expect(listing(recordDir())).toMatchInlineSnapshot(`
      [
        "attachments/a.png",
        "chat.db",
        "chat.db-wal",
        "handoff-notes.md",
        "settings.json",
      ]
    `);
    expect(listing(workDir())).toMatchInlineSnapshot(`
      [
        ".gitignore",
        ".tool-output/x.txt",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tasks/old-task/work/old.md",
        "work/report.md",
      ]
    `);
    expect(
      listing(
        path.join(
          workspaceLayout(workspace.path).setAsideDir,
          "chat-task-records",
          CHAT,
        ),
      ),
    ).toMatchInlineSnapshot(`
      [
        "old-task/task.db",
        "records-only/task.db",
      ]
    `);
    expect(fs.readFileSync(path.join(recordDir(), "chat.db"), "utf8")).toBe(
      "db",
    );
    expect(
      fs.readFileSync(path.join(recordDir(), "handoff-notes.md"), "utf8"),
    ).toBe("notes");

    // A path stored relative to the chat's old folder reads the same file
    // against its work folder.
    const report = resolvePathWithinChatDir({
      dir: AbsolutePathSchema.parse(workDir()),
      filePath: RelativePathSchema.parse("work/report.md"),
    });
    expect(report && fs.readFileSync(report, "utf8")).toBe("report");

    expect(listing(path.join(workspace.path, ".instrument", "window")))
      .toMatchInlineSnapshot(`
      [
        "chat.db",
      ]
    `);
    expect(listing(workDir("window"))).toMatchInlineSnapshot(`
      [
        "downloads/a.pdf",
      ]
    `);

    expect(readMovedPaths(machine.path)).toEqual([
      {
        from: workspaceLayout(workspace.path).chatsDir,
        to: path.join(machine.path, "work"),
      },
      {
        from: path.join(workspace.path, ".instrument", "window"),
        to: path.join(machine.path, "work", "window"),
      },
    ]);
  });

  it("moves nothing on a second run", () => {
    writeBetaChat();
    split();
    const records = listing(recordDir());
    const work = listing(workDir());

    expect(split()).toEqual({ done: [], failed: 0 });
    expect(listing(recordDir())).toEqual(records);
    expect(listing(workDir())).toEqual(work);
  });

  it("leaves a chat the 1.x migration has not finished, under its dotted name", () => {
    const staged = path.join(
      workspaceLayout(workspace.path).chatsDir,
      ".staging-chat",
    );
    write(path.join(staged, ".instrument", "chat.db"));
    write(path.join(staged, "work", "draft.md"));

    split();

    expect(listing(staged)).toMatchInlineSnapshot(`
      [
        ".instrument/chat.db",
        "work/draft.md",
      ]
    `);
  });

  it("moves the old folder's entries into a work folder already there, leaving one that clashes", () => {
    write(path.join(recordDir(), ".instrument", "settings.json"), "{}");
    write(path.join(recordDir(), "work", "report.md"), "older");
    write(path.join(recordDir(), "work", "other.md"), "other");
    write(path.join(workDir(), "work", "report.md"), "newer");
    write(path.join(workDir(), "work", "new.md"), "new");

    const result = split();

    expect(result.failed).toBe(0);
    expect(result.done).toContain(
      `left ${path.join(recordDir(), "work", "report.md")}: ${path.join(workDir(), "work", "report.md")} is already there`,
    );
    expect(listing(workDir())).toMatchInlineSnapshot(`
      [
        "work/new.md",
        "work/other.md",
        "work/report.md",
      ]
    `);
    expect(
      fs.readFileSync(path.join(workDir(), "work", "report.md"), "utf8"),
    ).toBe("newer");
    expect(listing(recordDir())).toMatchInlineSnapshot(`
      [
        "settings.json",
        "work/report.md",
      ]
    `);
  });

  it("holds the settings back while the database could not move", () => {
    write(path.join(recordDir(), "chat.db"), "current");
    write(path.join(recordDir(), ".instrument", "chat.db"), "older");
    write(path.join(recordDir(), ".instrument", "settings.json"), "{}");

    const result = split();

    expect(result.done).toContain(
      `left ${path.join(recordDir(), ".instrument", "chat.db")}: ${path.join(recordDir(), "chat.db")} is already there`,
    );
    expect(listing(recordDir())).toMatchInlineSnapshot(`
      [
        ".instrument/chat.db",
        ".instrument/settings.json",
        "chat.db",
      ]
    `);
    expect(fs.readFileSync(path.join(recordDir(), "chat.db"), "utf8")).toBe(
      "current",
    );
  });

  it("leaves what it could not move for the next run, which finishes it", () => {
    writeBetaChat();
    // Something in the way of every work folder.
    write(path.join(machine.path, "work"), "not a folder");

    const failed = split();

    expect(failed.failed).toBeGreaterThan(0);
    expect(failed.done).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^could not move ${escape(path.join(recordDir(), "work"))} \\(`,
        ),
      ),
    );
    // The records moved; the work is still beside them.
    expect(listing(recordDir())).toContain("settings.json");
    expect(listing(recordDir())).toContain("work/report.md");

    fs.rmSync(path.join(machine.path, "work"));
    const retried = split();

    expect(retried.failed).toBe(0);
    expect(listing(recordDir())).toMatchInlineSnapshot(`
      [
        "attachments/a.png",
        "chat.db",
        "chat.db-wal",
        "handoff-notes.md",
        "settings.json",
      ]
    `);
    expect(listing(workDir())).toContain("work/report.md");
  });
});

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
