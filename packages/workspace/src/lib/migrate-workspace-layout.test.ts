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
    // renamed from the legacy instrument.json
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
    expect(read("tasks", "abc", ".instrument", "store.db")).toBe("db-bytes");
    expect(read("tasks", "abc", ".instrument", "state.json")).toBe(
      `{"showTutorial":true}`,
    );
    expect(read("tasks", "abc", "settings.json")).toBe(`{"name":"My Task"}`);

    // old names gone
    expect(exists("tasks", "abc", "instrument.json")).toBe(false);
    expect(exists("tasks", "abc", ".instrument", "sessions.db")).toBe(false);
    expect(exists("tasks", "abc", ".instrument", "project-state.json")).toBe(
      false,
    );
  });

  it("renames instrument.json -> settings.json for tasks already under tasks/", () => {
    // no projects/ dir; a task already migrated to tasks/ but still on the
    // legacy settings filename
    const taskDir = path.join(rootDir, "tasks", "abc");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "instrument.json"), `{"name":"Abc"}`);

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(false);
    expect(read("tasks", "abc", "settings.json")).toBe(`{"name":"Abc"}`);
    expect(exists("tasks", "abc", "instrument.json")).toBe(false);
  });

  it("renames sqlite sidecar files alongside the db", () => {
    writeLegacyTask("abc", {
      "sessions.db": "main",
      "sessions.db-shm": "shm",
      "sessions.db-wal": "wal",
    });

    migrateWorkspaceLayout({ rootDir });

    expect(read("tasks", "abc", ".instrument", "store.db")).toBe("main");
    expect(read("tasks", "abc", ".instrument", "store.db-wal")).toBe("wal");
    expect(read("tasks", "abc", ".instrument", "store.db-shm")).toBe("shm");
  });

  it("is idempotent — a second run no-ops", () => {
    writeLegacyTask("abc", { "sessions.db": "db" });

    const first = migrateWorkspaceLayout({ rootDir });
    const second = migrateWorkspaceLayout({ rootDir });

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(read("tasks", "abc", ".instrument", "store.db")).toBe("db");
  });

  it("does not clobber an existing migrated task and reports the conflict", () => {
    writeLegacyTask("abc", { "sessions.db": "legacy-db" });
    // an already-migrated task with the same id
    const migratedPrivate = path.join(rootDir, "tasks", "abc", ".instrument");
    fs.mkdirSync(migratedPrivate, { recursive: true });
    fs.writeFileSync(path.join(migratedPrivate, "store.db"), "current-db");

    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.conflictedTaskIds).toEqual(["abc"]);
    expect(result.movedTaskCount).toBe(0);
    // existing data preserved; legacy copy left behind (projects/ retained)
    expect(read("tasks", "abc", ".instrument", "store.db")).toBe("current-db");
    expect(exists("projects", "abc")).toBe(true);
    // the abandoned legacy copy is left entirely untouched (not even renamed)
    expect(read("projects", "abc", ".instrument", "sessions.db")).toBe(
      "legacy-db",
    );
  });

  it("re-migrates a projects/ dir that reappears later", () => {
    writeLegacyTask("abc", { "sessions.db": "db" });
    migrateWorkspaceLayout({ rootDir });

    writeLegacyTask("def", { "sessions.db": "db2" });
    const result = migrateWorkspaceLayout({ rootDir });

    expect(result.migrated).toBe(true);
    expect(result.movedTaskCount).toBe(1);
    expect(read("tasks", "def", ".instrument", "store.db")).toBe("db2");
    expect(exists("projects")).toBe(false);
  });
});
