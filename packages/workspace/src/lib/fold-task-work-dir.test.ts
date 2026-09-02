import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldTaskWorkDir } from "./fold-task-work-dir";

let taskFolder: string;

beforeEach(() => {
  taskFolder = fs.mkdtempSync(path.join(os.tmpdir(), "fold-work-dir-"));
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

    foldTaskWorkDir(taskFolder);

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

    foldTaskWorkDir(taskFolder);

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

    foldTaskWorkDir(taskFolder);

    expect(read(".tmp/v8-compile-cache/entry.blob")).toBe("cache");
    expect(exists("work/tmp")).toBe(false);
  });

  it("leaves tool-output spill files where the task db points at them", () => {
    write("work/.tool-output/part-1.log", "spilled");

    foldTaskWorkDir(taskFolder);

    expect(read("work/.tool-output/part-1.log")).toBe("spilled");
    expect(exists(".tool-output")).toBe(false);
  });

  it("keeps the root copy when a half-finished fold left both", () => {
    write("package.json", `{"name":"newer"}`);
    write("work/package.json", `{"name":"older"}`);

    foldTaskWorkDir(taskFolder);

    expect(read("package.json")).toBe(`{"name":"newer"}`);
    expect(exists("work/package.json")).toBe(true);
  });

  it("is idempotent and does not rewrite a folded workspace file", () => {
    write("work/package.json", `{"name":"task"}`);
    write("work/pnpm-workspace.yaml", "packages:\n  - skills/*\n");

    foldTaskWorkDir(taskFolder);
    const afterFirst = read("pnpm-workspace.yaml");
    foldTaskWorkDir(taskFolder);

    expect(read("pnpm-workspace.yaml")).toBe(afterFirst);
    expect(read("package.json")).toBe(`{"name":"task"}`);
  });

  it("does nothing for a task that never had a work dir", () => {
    write("package.json", `{"name":"task"}`);

    expect(() => {
      foldTaskWorkDir(taskFolder);
    }).not.toThrow();
    expect(exists("work")).toBe(false);
  });
});
