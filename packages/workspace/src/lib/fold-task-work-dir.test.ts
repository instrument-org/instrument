import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldTaskWorkDir } from "./fold-task-work-dir";
import { type ChatRecordsSplit } from "./split-chat-records";

let taskFolder: string;
// What the fold left behind, one line per entry whose place was taken.
let left: ChatRecordsSplit;

beforeEach(() => {
  taskFolder = fs.mkdtempSync(path.join(os.tmpdir(), "fold-work-dir-"));
  left = { done: [], failed: 0 };
});

afterEach(() => {
  fs.rmSync(taskFolder, { force: true, recursive: true });
});

function exists(relativePath: string) {
  return fs.existsSync(path.join(taskFolder, relativePath));
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(taskFolder, relativePath), "utf8");
}

function write(relativePath: string, contents: string) {
  const target = path.join(taskFolder, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

describe("foldTaskWorkDir", () => {
  it("moves the package up to the task root", () => {
    write("work/package.json", `{"name":"@instrument-org/task"}`);
    write("work/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write(
      "work/node_modules/nanoid/index.js",
      "export const nanoid = () => {}",
    );
    write("work/.venv/pyvenv.cfg", "home = /somewhere\n");
    write("work/report.md", "the agent's own file");

    foldTaskWorkDir(taskFolder, left);

    expect(read("package.json")).toBe(`{"name":"@instrument-org/task"}`);
    expect(read("pnpm-lock.yaml")).toBe("lockfileVersion: '9.0'\n");
    expect(read("node_modules/nanoid/index.js")).toBe(
      "export const nanoid = () => {}",
    );
    expect(read(".venv/pyvenv.cfg")).toBe("home = /somewhere\n");
    expect(exists("work/package.json")).toBe(false);
    expect(exists("work/node_modules")).toBe(false);
    // work/ survives as scratch, holding what the agent wrote.
    expect(read("work/report.md")).toBe("the agent's own file");
  });

  it("repoints the skill globs and drops the add-to-the-root guard", () => {
    write(
      "work/pnpm-workspace.yaml",
      [
        "minimumReleaseAge: 10080",
        "allowBuilds:",
        "  sharp: true",
        "  esbuild: true",
        "packages:",
        "  - skills/*",
        "  - skills/*/*",
        "verifyDepsBeforeRun: false",
        "",
      ].join("\n"),
    );

    foldTaskWorkDir(taskFolder, left);

    expect(read("pnpm-workspace.yaml")).toMatchInlineSnapshot(`
      "minimumReleaseAge: 10080
      allowBuilds:
        sharp: true
        esbuild: true
      packages:
        - work/skills/*
        - work/skills/*/*
      verifyDepsBeforeRun: false
      ignoreWorkspaceRootCheck: true
      "
    `);
  });

  it("moves the temp dir under the name the file index excludes", () => {
    write("work/tmp/v8-compile-cache/entry.blob", "cache");

    foldTaskWorkDir(taskFolder, left);

    expect(read(".tmp/v8-compile-cache/entry.blob")).toBe("cache");
    expect(exists("work/tmp")).toBe(false);
  });

  it("leaves tool-output spill files where the task db points at them", () => {
    write("work/.tool-output/part-1.log", "spilled");

    foldTaskWorkDir(taskFolder, left);

    expect(read("work/.tool-output/part-1.log")).toBe("spilled");
    expect(exists(".tool-output")).toBe(false);
  });

  // The copy at the root is the newer of the two, so it wins; the one under
  // `work/` is named rather than passed over in silence, and goes to the
  // chat's work folder with the rest of `work/` when the records are split.
  it("keeps the root copy when a half-finished fold left both, and says so", () => {
    write("package.json", `{"name":"newer"}`);
    write("work/package.json", `{"name":"older"}`);
    write("work/tmp/cache.blob", "older");
    write(".tmp/cache.blob", "newer");

    foldTaskWorkDir(taskFolder, left);

    expect(read("package.json")).toBe(`{"name":"newer"}`);
    expect(read("work/package.json")).toBe(`{"name":"older"}`);
    expect(read("work/tmp/cache.blob")).toBe("older");
    expect(left).toEqual({
      done: [
        `left ${path.join(taskFolder, "work", "package.json")}: ${path.join(taskFolder, "package.json")} is already there`,
        `left ${path.join(taskFolder, "work", "tmp")}: ${path.join(taskFolder, ".tmp")} is already there`,
      ],
      failed: 0,
    });

    // A rerun leaves the same two files, and says the same of them.
    const after = { done: [], failed: 0 };
    foldTaskWorkDir(taskFolder, after);

    expect(read("package.json")).toBe(`{"name":"newer"}`);
    expect(read("work/package.json")).toBe(`{"name":"older"}`);
    expect(after).toEqual(left);
  });

  it("is idempotent and does not rewrite a folded workspace file", () => {
    write("work/package.json", `{"name":"task"}`);
    write("work/pnpm-workspace.yaml", "packages:\n  - skills/*\n");

    foldTaskWorkDir(taskFolder, left);
    const afterFirst = read("pnpm-workspace.yaml");
    foldTaskWorkDir(taskFolder, left);

    expect(read("pnpm-workspace.yaml")).toBe(afterFirst);
    expect(read("package.json")).toBe(`{"name":"task"}`);
  });

  it("does nothing for a task that never had a work dir", () => {
    write("package.json", `{"name":"task"}`);

    expect(() => {
      foldTaskWorkDir(taskFolder, left);
    }).not.toThrow();
    expect(exists("work")).toBe(false);
  });
});
