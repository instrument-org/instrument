import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { TaskDirSchema } from "../schemas/paths";
import {
  diffTaskFileIndexes,
  getTaskFileIndex,
  outputArtifactsFromChanges,
} from "./get-task-files";

describe("getTaskFileIndex", () => {
  let taskDirPath: string;
  let dir: ReturnType<typeof TaskDirSchema.parse>;

  beforeEach(async () => {
    taskDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "task-files-"));
    dir = TaskDirSchema.parse(taskDirPath);

    await fs.mkdir(path.join(taskDirPath, "output"), { recursive: true });
    await fs.mkdir(path.join(taskDirPath, "tmp"), { recursive: true });
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
    await fs.writeFile(path.join(taskDirPath, "tmp", "scratch.txt"), "tmp");
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
      { file: "state.json", subdir: TASK_FOLDER_NAMES.state },
      { file: "scratch.txt", subdir: TASK_FOLDER_NAMES.tmp },
      { file: "dep.js", subdir: "node_modules" },
    ];

    for (const { file, subdir } of internalEntries) {
      await fs.mkdir(path.join(taskDirPath, subdir), { recursive: true });
      await fs.writeFile(path.join(taskDirPath, subdir, file), "internal");
    }

    await fs.writeFile(path.join(taskDirPath, TASK_SETTINGS_FILE_NAME), "{}");
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
    expect(filePaths).not.toContain(TASK_SETTINGS_FILE_NAME);
    expect(filePaths).not.toContain("pnpm-lock.yaml");
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

  it("diffs file index snapshots and extracts output artifacts", async () => {
    const beforeResult = await getTaskFileIndex(dir);
    expect(beforeResult.isOk()).toBe(true);
    if (beforeResult.isErr()) {
      return;
    }

    await fs.writeFile(path.join(taskDirPath, "notes.md"), "changed");
    await fs.writeFile(path.join(taskDirPath, "output", "new.txt"), "new");
    await fs.rm(path.join(taskDirPath, "output", "chart.png"));

    const afterResult = await getTaskFileIndex(dir);
    expect(afterResult.isOk()).toBe(true);
    if (afterResult.isErr()) {
      return;
    }

    const changes = diffTaskFileIndexes({
      after: afterResult.value,
      before: beforeResult.value,
    });

    expect(changes.map((change) => [change.filePath, change.status]))
      .toMatchInlineSnapshot(`
        [
          [
            "notes.md",
            "modified",
          ],
          [
            "output/chart.png",
            "deleted",
          ],
          [
            "output/new.txt",
            "added",
          ],
        ]
      `);
    expect(outputArtifactsFromChanges(changes)).toEqual([
      {
        filePath: "output/new.txt",
        modifiedAt: expect.any(Number),
      },
    ]);
  });
});
