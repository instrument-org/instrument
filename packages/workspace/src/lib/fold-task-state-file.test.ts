import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldTaskStateFile } from "./fold-task-state-file";

let taskFolder: string;

beforeEach(() => {
  taskFolder = fs.mkdtempSync(path.join(os.tmpdir(), "fold-task-state-"));
  fs.mkdirSync(path.join(taskFolder, ".instrument"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(taskFolder, { force: true, recursive: true });
});

function exists(name: string): boolean {
  return fs.existsSync(path.join(taskFolder, ".instrument", name));
}

function read(name: string): string {
  return fs.readFileSync(path.join(taskFolder, ".instrument", name), "utf8");
}

function write(name: string, contents: unknown): void {
  fs.writeFileSync(
    path.join(taskFolder, ".instrument", name),
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
}

describe("foldTaskStateFile", () => {
  it("moves the state file under the settings file's state key", () => {
    write("settings.json", { name: "My task", pinnedAt: "2026-01-01" });
    write("state.json", { promptDraft: "half typed", showTutorial: true });

    expect(foldTaskStateFile(taskFolder)).toBe(true);

    expect(JSON.parse(read("settings.json"))).toEqual({
      name: "My task",
      pinnedAt: "2026-01-01",
      state: { promptDraft: "half typed", showTutorial: true },
    });
    expect(exists("state.json")).toBe(false);
  });

  it("folds a task that has state but no settings yet", () => {
    write("state.json", { showTutorial: true });

    expect(foldTaskStateFile(taskFolder)).toBe(true);

    expect(JSON.parse(read("settings.json"))).toEqual({
      state: { showTutorial: true },
    });
  });

  it("no-ops for a task already folded", () => {
    write("settings.json", { name: "My task", state: { showTutorial: true } });

    expect(foldTaskStateFile(taskFolder)).toBe(false);
    expect(JSON.parse(read("settings.json"))).toEqual({
      name: "My task",
      state: { showTutorial: true },
    });
  });

  // A fold that died between the write and the delete leaves both files, and
  // the settings file is the one that has been written to since.
  it("keeps the folded state when a stale state file is still present", () => {
    write("settings.json", { name: "My task", state: { promptDraft: "new" } });
    write("state.json", { promptDraft: "stale" });

    expect(foldTaskStateFile(taskFolder)).toBe(true);

    expect(JSON.parse(read("settings.json"))).toEqual({
      name: "My task",
      state: { promptDraft: "new" },
    });
    expect(exists("state.json")).toBe(false);
  });

  it("leaves both files alone when the settings cannot be read", () => {
    write("settings.json", "{ truncated");
    write("state.json", { promptDraft: "keep me" });

    expect(foldTaskStateFile(taskFolder)).toBe(false);

    expect(read("settings.json")).toBe("{ truncated");
    expect(exists("state.json")).toBe(true);
  });

  it("leaves both files alone when the state cannot be read", () => {
    write("settings.json", { name: "My task" });
    write("state.json", "{ truncated");

    expect(foldTaskStateFile(taskFolder)).toBe(false);

    expect(exists("state.json")).toBe(true);
    expect(JSON.parse(read("settings.json"))).toEqual({ name: "My task" });
  });

  it("no-ops for a folder with neither file", () => {
    expect(foldTaskStateFile(taskFolder)).toBe(false);
    expect(exists("settings.json")).toBe(false);
  });
});
