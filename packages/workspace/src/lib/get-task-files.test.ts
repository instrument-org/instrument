import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { TaskDirSchema } from "../schemas/paths";
import { getTaskFileIndex } from "./get-task-files";

describe("getTaskFileIndex", () => {
  let taskDirPath: string;
  let dir: ReturnType<typeof TaskDirSchema.parse>;

  beforeEach(async () => {
    taskDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "task-files-"));
    dir = TaskDirSchema.parse(taskDirPath);

    await fs.mkdir(path.join(taskDirPath, "output"), { recursive: true });
    await fs.mkdir(path.join(taskDirPath, ".instrument"), { recursive: true });
    await fs.mkdir(path.join(taskDirPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.mkdir(path.join(taskDirPath, ".git", "objects"), {
      recursive: true,
    });

    await fs.writeFile(path.join(taskDirPath, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(taskDirPath, "output", "chart.png"), "png");
    await fs.writeFile(path.join(taskDirPath, "notes.md"), "hello");
    await fs.writeFile(path.join(taskDirPath, "ignored.txt"), "ignored");
    await fs.writeFile(
      path.join(taskDirPath, ".instrument", "scratch.txt"),
      "private",
    );
    await fs.writeFile(
      path.join(taskDirPath, "node_modules", "pkg", "index.js"),
      "module",
    );
    await fs.writeFile(path.join(taskDirPath, ".git", "HEAD"), "ref");
  });

  afterEach(async () => {
    await fs.rm(taskDirPath, { force: true, recursive: true });
  });

  it("lists task files from disk while ignoring git, ignored, and transient files", async () => {
    const result = await getTaskFileIndex(dir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect([...result.value.keys()]).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "notes.md",
        "output/chart.png",
      ]
    `);
  });

  it("excludes every internal folder and generated file from the index", async () => {
    const internalEntries: { file: string; subdir: string }[] = [
      { file: "secret.json", subdir: TASK_FOLDER_NAMES.private },
      {
        file: "shot.png",
        subdir: `${TASK_FOLDER_NAMES.private}/${TASK_FOLDER_NAMES.screenshots}`,
      },
      { file: "dep.js", subdir: "node_modules" },
    ];

    for (const { file, subdir } of internalEntries) {
      await fs.mkdir(path.join(taskDirPath, subdir), { recursive: true });
      await fs.writeFile(path.join(taskDirPath, subdir, file), "internal");
    }

    await fs.writeFile(path.join(taskDirPath, "pnpm-lock.yaml"), "lockfile");

    const result = await getTaskFileIndex(dir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const filePaths = [...result.value.keys()];
    for (const { subdir } of internalEntries) {
      expect(filePaths.some((p) => p.startsWith(`${subdir}/`))).toBe(false);
    }
    expect(filePaths).not.toContain("pnpm-lock.yaml");
  });

  // A persisted baseline outlives the ignore list that produced it, so widening
  // that list must not turn everything it newly covers into a deletion. The
  // agent would otherwise be told the user deleted a venv that is merely no
  // longer indexed.
  // A Python task's venv alone runs to hundreds of files, past the index cap
  // once it holds the scientific stack, so leaving these enumerated would both
  // bury the task's own files and drown the change list the user reads.

  it("excludes dependency trees and tool caches wherever they sit", async () => {
    const generated = [
      { dir: "work/.venv/lib/python3.12", file: "x.so" },
      { dir: "work/__pycache__", file: "m.pyc" },
      { dir: "work/skills/docx/node_modules/dep", file: "index.js" },
      { dir: "work/.pytest_cache", file: "log" },
    ];

    for (const { dir: subdir, file } of generated) {
      await fs.mkdir(path.join(taskDirPath, subdir), { recursive: true });
      await fs.writeFile(path.join(taskDirPath, subdir, file), "generated");
    }
    await fs.writeFile(path.join(taskDirPath, "work-note.py"), "code");

    const result = await getTaskFileIndex(dir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const filePaths = [...result.value.keys()];
    for (const { dir: subdir } of generated) {
      expect(filePaths.some((p) => p.startsWith(`${subdir}/`))).toBe(false);
    }
    expect(filePaths).toContain("work-note.py");
  });

  it("skips symbolic links and caps recursive scans", async () => {
    await fs.mkdir(path.join(taskDirPath, "many"), { recursive: true });
    await fs.symlink(
      path.join(taskDirPath, "notes.md"),
      path.join(taskDirPath, "linked-notes.md"),
    );

    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(taskDirPath, "many", `${i}.txt`), `${i}`);
    }

    const result = await getTaskFileIndex(dir, { maxFiles: 4 });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const filePaths = [...result.value.keys()];
    expect(filePaths).toHaveLength(4);
    expect(filePaths).not.toContain("linked-notes.md");
  });

  it("skips a subtree that vanishes mid-walk instead of failing the whole index", async () => {
    await fs.mkdir(path.join(taskDirPath, "work", "gone", "deep"), {
      recursive: true,
    });
    await fs.writeFile(path.join(taskDirPath, "work", "keep.txt"), "keep");
    await fs.writeFile(
      path.join(taskDirPath, "work", "gone", "deep", "x.txt"),
      "x",
    );

    // Simulate the race: the parent's readdir listed `work/gone` as a dir, but
    // it is deleted before the walk recurses into it, so its readdir throws.
    const goneDir = path.join(taskDirPath, "work", "gone");
    const realReaddir = fs.readdir;
    vi.spyOn(fs, "readdir").mockImplementation(
      (...args: Parameters<typeof realReaddir>) => {
        if (args[0] === goneDir) {
          return Promise.reject(
            Object.assign(
              new Error(
                `ENOENT: no such file or directory, scandir '${goneDir}'`,
              ),
              { code: "ENOENT" },
            ),
          );
        }
        return realReaddir(...args);
      },
    );

    const result = await getTaskFileIndex(dir);
    vi.restoreAllMocks();

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const keys = [...result.value.keys()];
    expect(keys).toContain("work/keep.txt");
    expect(keys.some((key) => key.startsWith("work/gone"))).toBe(false);
  });

  it("skips filenames that normalize into a traversal path instead of aborting", async () => {
    await fs.writeFile(
      path.join(taskDirPath, "a\\..\\..\\b\\..\\..\\outside.txt"),
      "adversarial",
    );

    const result = await getTaskFileIndex(dir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect([...result.value.keys()]).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "notes.md",
        "output/chart.png",
      ]
    `);
  });
});
