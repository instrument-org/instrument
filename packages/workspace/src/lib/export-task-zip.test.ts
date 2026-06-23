import { BlobReader, ZipReader } from "@zip.js/zip.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { TaskDirSchema } from "../schemas/paths";
import { exportTaskZip } from "./export-task-zip";

let outputPath: string;
let taskDirPath: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-task-zip-"));
  taskDirPath = path.join(tempDir, "task");
  outputPath = path.join(tempDir, "task.zip");
  await fs.mkdir(path.join(taskDirPath, TASK_FOLDER_NAMES.private), {
    recursive: true,
  });
});

afterEach(async () => {
  await fs.rm(tempDir, { force: true, recursive: true });
});

describe("exportTaskZip", () => {
  it("includes private task settings", async () => {
    await fs.writeFile(path.join(taskDirPath, "notes.md"), "hello");
    await fs.writeFile(
      path.join(taskDirPath, TASK_FOLDER_NAMES.private, "settings.json"),
      `{"name":"Test"}`,
    );

    const result = await exportTaskZip({
      dir: TaskDirSchema.parse(taskDirPath),
      outputPath,
    });

    expect(result.isOk()).toBe(true);

    const zipReader = new ZipReader(
      new BlobReader(new Blob([await fs.readFile(outputPath)])),
    );
    const entries = await zipReader.getEntries();
    await zipReader.close();

    expect(entries.map((entry) => entry.filename).sort())
      .toMatchInlineSnapshot(`
        [
          ".instrument/settings.json",
          "notes.md",
        ]
      `);
  });
});
