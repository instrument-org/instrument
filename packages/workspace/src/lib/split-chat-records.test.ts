import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workspaceLayout } from "./workspace-layout";
import { AbsolutePathSchema, RelativePathSchema } from "../schemas/paths";
import { resolvePathWithinChatDir } from "./resolve-path-within-chat-dir";
import { splitChatRecords } from "./split-chat-records";
import { withTempDir } from "../test/helpers/temp-dir";

const workspace = withTempDir("split-chat-records-workspace");
const machine = withTempDir("split-chat-records-machine");
const outside = withTempDir("split-chat-records-outside");

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
    workFoldersDir: path.join(machine.path, "work"),
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
  });

  it("drops the copies of the app's own skills, leaving the agent's to move", () => {
    const dir = recordDir();
    write(path.join(dir, ".instrument", "settings.json"), "{}");
    for (const copy of [
      ["work", "skills", "instrument", "pdf"],
      ["work", "skills", "system", "skill-creator"],
      ["skills", "instrument", "sharp-images"],
      ["tasks", "old-task", "work", "skills", "instrument", "zip"],
    ]) {
      write(path.join(dir, ...copy, "SKILL.md"));
      write(path.join(dir, ...copy, "scripts", "run.py"));
      write(path.join(dir, ...copy, "node_modules", ".pnpm", "x", "index.js"));
    }
    write(path.join(dir, "work", "skills", "my-own", "SKILL.md"), "mine");
    write(path.join(dir, "work", "skills", "instrument", "notes.md"), "mine");
    write(path.join(dir, "skills", "workspace", "mine", "SKILL.md"), "mine");
    write(path.join(dir, "work", "report.md"), "report");

    const result = split();

    expect(result.failed).toBe(0);
    expect(listing(workDir())).toMatchInlineSnapshot(`
      [
        "skills/workspace/mine/SKILL.md",
        "work/report.md",
        "work/skills/instrument/notes.md",
        "work/skills/my-own/SKILL.md",
      ]
    `);
    expect(result.done.map((line) => line.replace(workDir(), "<work>")))
      .toMatchInlineSnapshot(`
      [
        "2026-10-01-beta: .instrument/settings.json, skills/instrument/sharp-images (removed), work/skills/instrument/pdf (removed), work/skills/system/skill-creator (removed), tasks/old-task/work/skills/instrument/zip (removed), skills, work, with its work in <work>",
      ]
    `);
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

    // Counted, so the sweep runs again rather than leaving it for good.
    expect(result.failed).toBe(1);
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

  // Notes already beside the records are the ones the chat keeps writing, so
  // they stay; the older ones under `work/` are named and go to the work
  // folder with the rest of it, rather than being passed over in silence.
  it("leaves the notes under work/ where notes are already beside the records", () => {
    write(path.join(recordDir(), "chat.db"), "db");
    write(path.join(recordDir(), "handoff-notes.md"), "newer");
    write(path.join(recordDir(), "work", "handoff-notes.md"), "older");

    const result = split();

    expect(result.failed).toBe(1);
    expect(result.done).toContain(
      `left ${path.join(recordDir(), "work", "handoff-notes.md")}: ${path.join(recordDir(), "handoff-notes.md")} is already there`,
    );
    expect(listing(recordDir())).toEqual(["chat.db", "handoff-notes.md"]);
    expect(
      fs.readFileSync(path.join(recordDir(), "handoff-notes.md"), "utf8"),
    ).toBe("newer");
    // Both are still a person's to read, and the next run has nothing left
    // to leave.
    expect(listing(workDir())).toEqual(["work/handoff-notes.md"]);
    expect(split()).toEqual({ done: [], failed: 0 });
    expect(listing(recordDir())).toEqual(["chat.db", "handoff-notes.md"]);
    expect(listing(workDir())).toEqual(["work/handoff-notes.md"]);
  });

  it("holds the settings back while the database could not move", () => {
    write(path.join(recordDir(), "chat.db"), "current");
    write(path.join(recordDir(), ".instrument", "chat.db"), "older");
    write(path.join(recordDir(), ".instrument", "settings.json"), "{}");

    const result = split();

    expect(result.failed).toBe(1);
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

    // Once the clash is settled, the next run moves the settings it held back.
    fs.rmSync(path.join(recordDir(), ".instrument", "chat.db"));
    expect(split().failed).toBe(0);
    expect(listing(recordDir())).toEqual(["chat.db", "settings.json"]);
  });

  it("acts on a link at any level of an old chat folder, never on what it points to", () => {
    // Outside the workspace: a folder for each link to point at, each
    // holding what the split would move or drop if it followed the link.
    const target = (name: string) => path.join(outside.path, name);
    for (const name of ["records", "tasks", "task", "work", "skills"]) {
      write(path.join(target(name), ".instrument", "chat.db"), "theirs");
      write(path.join(target(name), ".instrument", "settings.json"), "{}");
      write(path.join(target(name), ".instrument", "agent-browser-home", "x"));
      write(path.join(target(name), "handoff-notes.md"), "theirs");
      write(path.join(target(name), "SKILL.md"), "theirs");
      write(path.join(target(name), "some-skill", "SKILL.md"), "theirs");
      write(path.join(target(name), "instrument", "pdf", "SKILL.md"), "theirs");
      write(path.join(target(name), "t1", ".venv", "bin", "python"), "theirs");
      write(path.join(target(name), "t1", "node_modules", "x.js"), "theirs");
      write(path.join(target(name), "t1", ".instrument", "task.db"), "theirs");
      write(
        path.join(
          target(name),
          "t1",
          "skills",
          "instrument",
          "zip",
          "SKILL.md",
        ),
        "theirs",
      );
      write(path.join(target(name), ".venv", "bin", "python"), "theirs");
      write(path.join(target(name), "node_modules", "x.js"), "theirs");
    }
    const before = listing(outside.path);
    const link = (to: string, ...at: string[]) => {
      fs.mkdirSync(path.join(recordDir(), ...at.slice(0, -1)), {
        recursive: true,
      });
      fs.symlinkSync(to, path.join(recordDir(), ...at));
    };
    // In one chat, each place the split reads into or drops, as a link.
    write(path.join(recordDir(), "chat.db"), "db");
    link(target("records"), ".instrument");
    link(target("work"), "work");
    link(target("skills"), "skills", "instrument");
    link(path.join(target("skills"), "some-skill"), "skills", "system", "copy");
    link(target("tasks"), "tasks");
    link(target("node_modules"), "node_modules");
    link(target(".venv"), ".venv");
    // In a second, a real tasks/ folder holding links.
    const other = recordDir("2026-10-02-other");
    write(path.join(other, "chat.db"), "db");
    fs.mkdirSync(path.join(other, "tasks", "t2"), { recursive: true });
    fs.symlinkSync(target("task"), path.join(other, "tasks", "t1"));
    fs.symlinkSync(
      path.join(target("task"), "t1", ".venv"),
      path.join(other, "tasks", "t2", ".venv"),
    );
    fs.symlinkSync(
      path.join(target("task"), "t1", ".instrument"),
      path.join(other, "tasks", "t2", ".instrument"),
    );
    fs.symlinkSync(target("work"), path.join(other, "tasks", "t2", "skills"));
    // And a chat folder that is a link itself.
    fs.symlinkSync(target("records"), recordDir("2026-10-03-linked"));

    split();

    expect(listing(outside.path)).toEqual(before);
    const isLink = (entry: string) => fs.lstatSync(entry).isSymbolicLink();
    // Links in what moved went as links; links in place of what is
    // dropped are gone, and so is the one in place of an app skill copy.
    expect(isLink(path.join(workDir(), "work"))).toBe(true);
    expect(isLink(path.join(workDir(), "tasks"))).toBe(true);
    expect(isLink(path.join(workDir(), "skills", "instrument"))).toBe(true);
    expect(fs.existsSync(path.join(workDir(), "skills", "system"))).toBe(false);
    expect(fs.existsSync(path.join(workDir(), "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(workDir(), ".venv"))).toBe(false);
    expect(isLink(path.join(recordDir(), ".instrument"))).toBe(true);
    expect(fs.existsSync(path.join(recordDir(), "settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(recordDir(), "handoff-notes.md"))).toBe(
      false,
    );
    expect(isLink(path.join(workDir("2026-10-02-other"), "tasks", "t1"))).toBe(
      true,
    );
    expect(
      isLink(path.join(workDir("2026-10-02-other"), "tasks", "t2", "skills")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workDir("2026-10-02-other"), "tasks", "t2", ".venv"),
      ),
    ).toBe(false);
    expect(
      isLink(
        path.join(
          workspaceLayout(workspace.path).setAsideDir,
          "chat-task-records",
          "2026-10-02-other",
          "t2",
        ),
      ),
    ).toBe(true);
    expect(isLink(recordDir("2026-10-03-linked"))).toBe(true);
  });

  it("leaves a chats folder that is a link whole", () => {
    write(path.join(outside.path, CHAT, ".instrument", "chat.db"), "theirs");
    write(path.join(outside.path, CHAT, ".venv", "bin", "python"), "theirs");
    fs.mkdirSync(path.join(workspace.path, ".instrument"), { recursive: true });
    fs.symlinkSync(outside.path, workspaceLayout(workspace.path).chatsDir);
    const before = listing(outside.path);

    const result = split();

    expect(result.done).toEqual([
      `left ${workspaceLayout(workspace.path).chatsDir}: it is a link`,
    ]);
    expect(listing(outside.path)).toEqual(before);
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
