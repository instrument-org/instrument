import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateWorkspaceLayout } from "./migrate-workspace-layout";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-layout-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { force: true, recursive: true });
});

function exists(...segments: string[]): boolean {
  return fs.existsSync(path.join(rootDir, ...segments));
}

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(rootDir, ...segments), "utf8");
}

function writeLegacyTask(id: string, files: Record<string, string> = {}): void {
  const privateDir = path.join(rootDir, "projects", id, ".instrument");
  fs.mkdirSync(privateDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(privateDir, name), contents);
  }
}

// A real projects-feature folder: human-named, with a ProjectId in its settings.
function writeProjectFolder(name: string, projectId: string): void {
  const privateDir = path.join(rootDir, "projects", name, ".instrument");
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(
    path.join(privateDir, "settings.json"),
    JSON.stringify({ createdAt: new Date(0).toISOString(), id: projectId }),
  );
  fs.writeFileSync(path.join(rootDir, "projects", name, "AGENTS.md"), "do x");
}

describe("migrateWorkspaceLayout", () => {
  it("no-ops when there is no legacy projects/ dir", () => {
    const result = migrateWorkspaceLayout({ rootDir });
    expect(result).toEqual({
      conflictedTaskIds: [],
      migrated: false,
      movedTaskCount: 0,
    });
    expect(exists("tasks")).toBe(false);
  });

  it("moves tasks and renames db + state files", () => {
    writeLegacyTask("abc", {
      "project-state.json": `{"showTutorial":true}`,
      "sessions.db": "db-bytes",
    });
    // a settings file at the task root should travel with the folder and be
    // moved into the private dir from the legacy instrument.json
    fs.writeFileSync(
      path.join(rootDir, "projects", "abc", "instrument.json"),
      `{"name":"My Task"}`,
    );

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(true);
    expect(result.movedTaskCount).toBe(1);
    expect(result.conflictedTaskIds).toEqual([]);

    // legacy dir gone
    expect(exists("projects")).toBe(false);

    // renamed + relocated under tasks/
    expect(read("tasks", "abc", ".instrument", "task.db")).toBe("db-bytes");
    expect(read("tasks", "abc", ".instrument", "state.json")).toBe(
      `{"showTutorial":true}`,
    );
    expect(read("tasks", "abc", ".instrument", "settings.json")).toBe(
      `{"name":"My Task"}`,
    );

    // old names gone
    expect(exists("tasks", "abc", "instrument.json")).toBe(false);
    expect(exists("tasks", "abc", "settings.json")).toBe(false);
    expect(exists("tasks", "abc", ".instrument", "sessions.db")).toBe(false);
    expect(exists("tasks", "abc", ".instrument", "project-state.json")).toBe(
      false,
    );
  });

  it("moves instrument.json -> .instrument/settings.json for tasks already under tasks/", () => {
    // no projects/ dir; a task already migrated to tasks/ but still on the
    // legacy settings filename
    const taskDir = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "instrument.json"), `{"name":"Abc"}`);

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(false);
    expect(read("tasks", "abc", ".instrument", "settings.json")).toBe(
      `{"name":"Abc"}`,
    );
    expect(exists("tasks", "abc", "instrument.json")).toBe(false);
  });

  it("moves root settings.json -> .instrument/settings.json", () => {
    const taskDir = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "settings.json"), `{"name":"Abc"}`);

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(false);
    expect(read("tasks", "abc", ".instrument", "settings.json")).toBe(
      `{"name":"Abc"}`,
    );
    expect(exists("tasks", "abc", "settings.json")).toBe(false);
  });

  it("renames sqlite sidecar files alongside the db", () => {
    writeLegacyTask("abc", {
      "sessions.db": "main",
      "sessions.db-shm": "shm",
      "sessions.db-wal": "wal",
    });

    migrateWorkspaceLayout({ rootDir });

    expect(read("tasks", "abc", ".instrument", "task.db")).toBe("main");
    expect(read("tasks", "abc", ".instrument", "task.db-wal")).toBe("wal");
    expect(read("tasks", "abc", ".instrument", "task.db-shm")).toBe("shm");
  });

  it("is idempotent — a second run no-ops", () => {
    writeLegacyTask("abc", { "sessions.db": "db" });

    const first = migrateWorkspaceLayout({ rootDir });
    const second = migrateWorkspaceLayout({ rootDir });

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(read("tasks", "abc", ".instrument", "task.db")).toBe("db");
  });

  it("does not clobber an existing migrated task and reports the conflict", () => {
    writeLegacyTask("abc", { "sessions.db": "legacy-db" });
    // an already-migrated task with the same id
    const migratedPrivate = path.join(rootDir, "tasks", "abc", ".instrument");
    fs.mkdirSync(migratedPrivate, { recursive: true });
    fs.writeFileSync(path.join(migratedPrivate, "task.db"), "current-db");

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.conflictedTaskIds).toEqual(["abc"]);
    expect(result.movedTaskCount).toBe(0);
    // existing data preserved; legacy copy left behind (projects/ retained)
    expect(read("tasks", "abc", ".instrument", "task.db")).toBe("current-db");
    expect(exists("projects", "abc")).toBe(true);
    // the abandoned legacy copy is left entirely untouched (not even renamed)
    expect(read("projects", "abc", ".instrument", "sessions.db")).toBe(
      "legacy-db",
    );
  });

  it("runs the legacy projects/ move at most once (marker gated)", () => {
    writeLegacyTask("abc", { "sessions.db": "db" });
    migrateWorkspaceLayout({ rootDir });

    // projects/ now belongs to the projects feature. A folder appearing there
    // later must NOT be drained into tasks/, even if it looks task-shaped.
    writeLegacyTask("def", { "sessions.db": "db2" });
    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(false);
    expect(result.movedTaskCount).toBe(0);
    expect(exists("tasks", "def")).toBe(false);
    expect(read("projects", "def", ".instrument", "sessions.db")).toBe("db2");
  });

  it("never moves a real project folder, and records completion", () => {
    // cspell:ignore prj_01ARZ3NDEKTSV4RRFFQ69G5FAV
    writeProjectFolder("My Project", "prj_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const result = migrateWorkspaceLayout({ rootDir });

    // The project folder stays put; nothing is treated as a legacy task.
    expect(result.movedTaskCount).toBe(0);
    expect(result.conflictedTaskIds).toEqual([]);
    expect(exists("projects", "My Project", "AGENTS.md")).toBe(true);
    expect(exists("tasks", "My Project")).toBe(false);
    // Marker written so the pass never re-runs against the live projects/ dir.
    expect(exists(".instrument", "migrations.json")).toBe(true);
  });

  it("drains legacy tasks but leaves project folders in projects/", () => {
    writeLegacyTask("legacy-task", { "sessions.db": "db" });
    writeProjectFolder("My Project", "prj_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.movedTaskCount).toBe(1);
    expect(read("tasks", "legacy-task", ".instrument", "task.db")).toBe("db");
    // The real project is untouched; projects/ is retained because it remains.
    expect(exists("projects", "My Project", "AGENTS.md")).toBe(true);
    expect(exists("tasks", "My Project")).toBe(false);
  });

  it("folds the runnable package and agent dirs into work/", () => {
    const taskRoot = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(path.join(taskRoot, "skills", "pdf"), { recursive: true });
    fs.mkdirSync(path.join(taskRoot, "output"), { recursive: true });
    fs.writeFileSync(path.join(taskRoot, "package.json"), `{"name":"task"}`);
    fs.writeFileSync(path.join(taskRoot, "skills", "pdf", "SKILL.md"), "skill");
    fs.writeFileSync(path.join(taskRoot, "output", "report.md"), "out");

    migrateWorkspaceLayout({ rootDir });

    expect(read("tasks", "abc", "work", "package.json")).toBe(
      `{"name":"task"}`,
    );
    expect(read("tasks", "abc", "work", "skills", "pdf", "SKILL.md")).toBe(
      "skill",
    );
    // output stays at the task root
    expect(read("tasks", "abc", "output", "report.md")).toBe("out");
    expect(exists("tasks", "abc", "package.json")).toBe(false);
    expect(exists("tasks", "abc", "skills")).toBe(false);
  });

  it("leaves a legacy .state dir in place (db references point at it)", () => {
    const taskRoot = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(path.join(taskRoot, ".state", "agent-browser"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(taskRoot, ".state", "agent-browser", "shot.png"),
      "img",
    );

    migrateWorkspaceLayout({ rootDir });

    expect(read("tasks", "abc", ".state", "agent-browser", "shot.png")).toBe(
      "img",
    );
  });

  it("folds user-provided and agent-retrieved into attachments/", () => {
    const taskRoot = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(path.join(taskRoot, "user-provided"), { recursive: true });
    fs.mkdirSync(path.join(taskRoot, "agent-retrieved"), { recursive: true });
    fs.writeFileSync(path.join(taskRoot, "user-provided", "upload.txt"), "up");
    fs.writeFileSync(path.join(taskRoot, "agent-retrieved", "page.html"), "pg");

    migrateWorkspaceLayout({ rootDir });

    expect(read("tasks", "abc", "attachments", "upload.txt")).toBe("up");
    expect(read("tasks", "abc", "attachments", "page.html")).toBe("pg");
    expect(exists("tasks", "abc", "user-provided")).toBe(false);
    expect(exists("tasks", "abc", "agent-retrieved")).toBe(false);
  });
});
