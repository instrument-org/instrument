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

function readSettings(taskId: string): Record<string, unknown> {
  return JSON.parse(
    read("tasks", taskId, ".instrument", "settings.json"),
  ) as Record<string, unknown>;
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

function writeTaskSettings(taskId: string, settings: Record<string, unknown>) {
  const privateDir = path.join(rootDir, "tasks", taskId, ".instrument");
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(
    path.join(privateDir, "settings.json"),
    JSON.stringify(settings),
  );
}

const MARKER = [".instrument", ".legacy-projects-migrated"];

describe("migrateWorkspaceLayout", () => {
  it("no-ops when there is no legacy projects/ dir, but still records the marker", () => {
    const result = migrateWorkspaceLayout({ rootDir });
    expect(result).toEqual({
      conflictedTaskIds: [],
      movedTaskCount: 0,
      removedBrowserProfileCloneCount: 0,
    });
    expect(exists("tasks")).toBe(false);
    // Fresh install: the marker is dropped on first boot so a later project in
    // projects/ is never seen by a re-run.
    expect(exists(...MARKER)).toBe(true);
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

    expect(result.movedTaskCount).toBe(1);
    expect(result.conflictedTaskIds).toEqual([]);
    expect(exists(...MARKER)).toBe(true);

    // legacy dir gone
    expect(exists("projects")).toBe(false);

    // renamed + relocated under tasks/
    expect(read("tasks", "abc", ".instrument", "task.db")).toBe("db-bytes");
    expect(read("tasks", "abc", ".instrument", "state.json")).toBe(
      `{"showTutorial":true}`,
    );
    expect(readSettings("abc").name).toBe("My Task");

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

    migrateWorkspaceLayout({ rootDir });

    expect(readSettings("abc").name).toBe("Abc");
    expect(exists("tasks", "abc", "instrument.json")).toBe(false);
  });

  it("moves root settings.json -> .instrument/settings.json", () => {
    const taskDir = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "settings.json"), `{"name":"Abc"}`);

    migrateWorkspaceLayout({ rootDir });

    expect(readSettings("abc").name).toBe("Abc");
    expect(exists("tasks", "abc", "settings.json")).toBe(false);
  });

  describe("task timestamp stamps", () => {
    it("seeds both from the session db, so the list keeps the order it had", () => {
      writeTaskSettings("abc", { name: "Abc" });
      const dbPath = path.join(
        rootDir,
        "tasks",
        "abc",
        ".instrument",
        "task.db",
      );
      fs.writeFileSync(dbPath, "db");
      const madeAt = new Date("2026-01-02T03:04:05.000Z");
      const workedAt = new Date("2026-03-04T05:06:07.000Z");
      fs.utimesSync(dbPath, madeAt, workedAt);

      migrateWorkspaceLayout({ rootDir });

      // birthtime is not settable, so only the mtime-derived stamp is asserted
      // here: it is the one that orders the list.
      expect(readSettings("abc").lastActivityAt).toBe(workedAt.toISOString());
      expect(readSettings("abc").createdAt).toEqual(expect.any(String));
    });

    it("falls back to the task folder for a task that never opened a db", () => {
      writeTaskSettings("abc", { name: "Abc" });

      migrateWorkspaceLayout({ rootDir });

      const folderMtime = fs
        .statSync(path.join(rootDir, "tasks", "abc"))
        .mtime.toISOString();
      expect(readSettings("abc").lastActivityAt).toBe(folderMtime);
    });

    it("leaves stamps that are already recorded alone", () => {
      writeTaskSettings("abc", {
        createdAt: "2020-01-01T00:00:00.000Z",
        lastActivityAt: "2021-01-01T00:00:00.000Z",
        name: "Abc",
      });
      fs.writeFileSync(
        path.join(rootDir, "tasks", "abc", ".instrument", "task.db"),
        "db",
      );

      migrateWorkspaceLayout({ rootDir });

      expect(readSettings("abc")).toEqual({
        createdAt: "2020-01-01T00:00:00.000Z",
        lastActivityAt: "2021-01-01T00:00:00.000Z",
        name: "Abc",
      });
    });

    it("fills only the stamp that is missing", () => {
      writeTaskSettings("abc", {
        lastActivityAt: "2021-01-01T00:00:00.000Z",
        name: "Abc",
      });

      migrateWorkspaceLayout({ rootDir });

      expect(readSettings("abc").lastActivityAt).toBe(
        "2021-01-01T00:00:00.000Z",
      );
      expect(readSettings("abc").createdAt).toEqual(expect.any(String));
    });

    it("leaves a project folder that ended up under tasks/ untouched", () => {
      // cspell:ignore prj_01ARZ3NDEKTSV4RRFFQ69G5FAV
      writeTaskSettings("my-project", {
        createdAt: "2020-01-01T00:00:00.000Z",
        id: "prj_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      });

      migrateWorkspaceLayout({ rootDir });

      expect(readSettings("my-project").lastActivityAt).toBeUndefined();
    });

    it("skips settings it cannot read rather than overwriting them", () => {
      const privateDir = path.join(rootDir, "tasks", "abc", ".instrument");
      fs.mkdirSync(privateDir, { recursive: true });
      fs.writeFileSync(path.join(privateDir, "settings.json"), "{ not json");

      migrateWorkspaceLayout({ rootDir });

      expect(read("tasks", "abc", ".instrument", "settings.json")).toBe(
        "{ not json",
      );
    });
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

    expect(first.movedTaskCount).toBe(1);
    expect(second.movedTaskCount).toBe(0);
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

    // projects/ is now the live feature dir; marker must block a re-run.
    writeLegacyTask("def", { "sessions.db": "db2" });
    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.movedTaskCount).toBe(0);
    expect(exists("tasks", "def")).toBe(false);
    expect(read("projects", "def", ".instrument", "sessions.db")).toBe("db2");
  });

  it("never moves a real project folder, even with the marker absent", () => {
    // cspell:ignore prj_01ARZ3NDEKTSV4RRFFQ69G5FAV
    // The regression: a populated projects/ with no marker yet. The content
    // guard must keep the real project in place regardless of the marker.
    writeProjectFolder("My Project", "prj_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.movedTaskCount).toBe(0);
    expect(result.conflictedTaskIds).toEqual([]);
    expect(exists("projects", "My Project", "AGENTS.md")).toBe(true);
    expect(exists("tasks", "My Project")).toBe(false);
    expect(exists(...MARKER)).toBe(true);
  });

  it("drains legacy tasks but leaves project folders in projects/", () => {
    writeLegacyTask("legacy-task", { "sessions.db": "db" });
    writeProjectFolder("My Project", "prj_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.movedTaskCount).toBe(1);
    expect(read("tasks", "legacy-task", ".instrument", "task.db")).toBe("db");
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

  it("deletes a cloned Chrome profile left in the task's temp dir", () => {
    const tmpDir = path.join(rootDir, "tasks", "abc", "work", "tmp");
    const clone = path.join(tmpDir, "agent-browser-profile-abc-123", "Default");
    fs.mkdirSync(clone, { recursive: true });
    fs.writeFileSync(path.join(clone, "Cookies"), "sqlite");
    fs.writeFileSync(path.join(tmpDir, "scratch.csv"), "a,b");

    migrateWorkspaceLayout({ rootDir });

    expect(
      exists("tasks", "abc", "work", "tmp", "agent-browser-profile-abc-123"),
    ).toBe(false);
    // The agent's own temp files are the point of work/tmp; only the clone goes.
    expect(read("tasks", "abc", "work", "tmp", "scratch.csv")).toBe("a,b");
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
