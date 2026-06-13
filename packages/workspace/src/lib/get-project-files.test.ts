import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppDirSchema } from "../schemas/paths";
import {
  diffProjectFileIndexes,
  getProjectFileIndex,
  outputArtifactPathsFromChanges,
} from "./get-project-files";

describe("getProjectFileIndex", () => {
  let appDirPath: string;
  let appDir: ReturnType<typeof AppDirSchema.parse>;

  beforeEach(async () => {
    appDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "project-files-"));
    appDir = AppDirSchema.parse(appDirPath);

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
    const result = await getProjectFileIndex(appDir);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect([...result.value.keys()]).toMatchInlineSnapshot(`
      [
        "./.gitignore",
        "./notes.md",
        "./output/chart.png",
      ]
    `);
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

    const result = await getProjectFileIndex(appDir, { maxFiles: 4 });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const filePaths = [...result.value.keys()];
    expect(filePaths).toHaveLength(4);
    expect(filePaths).not.toContain("./linked-notes.md");
  });

  it("diffs file index snapshots and extracts output artifacts", async () => {
    const beforeResult = await getProjectFileIndex(appDir);
    expect(beforeResult.isOk()).toBe(true);
    if (beforeResult.isErr()) {
      return;
    }

    await fs.writeFile(path.join(appDirPath, "notes.md"), "changed");
    await fs.writeFile(path.join(appDirPath, "output", "new.txt"), "new");
    await fs.rm(path.join(appDirPath, "output", "chart.png"));

    const afterResult = await getProjectFileIndex(appDir);
    expect(afterResult.isOk()).toBe(true);
    if (afterResult.isErr()) {
      return;
    }

    const changes = diffProjectFileIndexes({
      after: afterResult.value,
      before: beforeResult.value,
    });

    expect(changes.map((change) => [change.filePath, change.status]))
      .toMatchInlineSnapshot(`
        [
          [
            "./notes.md",
            "modified",
          ],
          [
            "./output/chart.png",
            "deleted",
          ],
          [
            "./output/new.txt",
            "added",
          ],
        ]
      `);
    expect(outputArtifactPathsFromChanges(changes)).toEqual(["output/new.txt"]);
  });
});
