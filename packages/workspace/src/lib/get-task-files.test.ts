import { TASK_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_FOLDER_NAMES } from "../constants";
import { TaskDirSchema } from "../schemas/paths";
import {
  diffTaskFileIndexes,
  getTaskFileIndex,
  outputArtifactsFromChanges,
} from "./get-task-files";

describe("getTaskFileIndex", () => {
  let appDirPath: string;
  let dir: ReturnType<typeof TaskDirSchema.parse>;

  beforeEach(async () => {
    appDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "task-files-"));
    dir = TaskDirSchema.parse(appDirPath);

    await fs.mkdir(path.join(appDirPath, "output"), { recursive: true });
    await fs.mkdir(path.join(appDirPath, "tmp"), { recursive: true });
    await fs.mkdir(path.join(appDirPath, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appDirPath, ".git", "objects"), {
      recursive: true,
    });

    await fs.writeFile(path.join(appDirPath, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(appDirPath, "output", "chart.png"), "png");
    await fs.writeFile(path.join(appDirPath, "notes.md"), "hello");
    await fs.writeFile(path.join(appDirPath, "ignored.txt"), "ignored");
    await fs.writeFile(path.join(appDirPath, "tmp", "scratch.txt"), "tmp");
    await fs.writeFile(
      path.join(appDirPath, "node_modules", "pkg", "index.js"),
      "module",
    );
    await fs.writeFile(path.join(appDirPath, ".git", "HEAD"), "ref");
  });

  afterEach(async () => {
    await fs.rm(appDirPath, { force: true, recursive: true });
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
      { file: "secret.json", subdir: APP_FOLDER_NAMES.private },
      { file: "state.json", subdir: APP_FOLDER_NAMES.state },
      { file: "scratch.txt", subdir: APP_FOLDER_NAMES.tmp },
      { file: "dep.js", subdir: "node_modules" },
    ];

    for (const { file, subdir } of internalEntries) {
      await fs.mkdir(path.join(appDirPath, subdir), { recursive: true });
      await fs.writeFile(path.join(appDirPath, subdir, file), "internal");
    }

    await fs.writeFile(path.join(appDirPath, TASK_MANIFEST_FILE_NAME), "{}");
    await fs.writeFile(path.join(appDirPath, "pnpm-lock.yaml"), "lockfile");

    const result = await getTaskFileIndex(dir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const filePaths = [...result.value.keys()];
    for (const { subdir } of internalEntries) {
      expect(filePaths.some((p) => p.startsWith(`${subdir}/`))).toBe(false);
    }
    expect(filePaths).not.toContain(TASK_MANIFEST_FILE_NAME);
    expect(filePaths).not.toContain("pnpm-lock.yaml");
  });

  it("skips symbolic links and caps recursive scans", async () => {
    await fs.mkdir(path.join(appDirPath, "many"), { recursive: true });
    await fs.symlink(
      path.join(appDirPath, "notes.md"),
      path.join(appDirPath, "linked-notes.md"),
    );

    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(appDirPath, "many", `${i}.txt`), `${i}`);
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
      path.join(appDirPath, "a\\..\\..\\b\\..\\..\\outside.txt"),
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

    await fs.writeFile(path.join(appDirPath, "notes.md"), "changed");
    await fs.writeFile(path.join(appDirPath, "output", "new.txt"), "new");
    await fs.rm(path.join(appDirPath, "output", "chart.png"));

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
