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

  it("bundles task files but excludes node_modules and the browser profile/home", async () => {
    const privateDir = path.join(taskDirPath, TASK_FOLDER_NAMES.private);
    const workDir = path.join(taskDirPath, TASK_FOLDER_NAMES.work);

    // Included: settings, screenshots, tool-output, work source, root downloads.
    // Screenshots and tool-output now live under work/ (agent-readable), not the
    // private dir, which is off-limits to the agent.
    await fs.writeFile(
      path.join(privateDir, "settings.json"),
      `{"name":"Test"}`,
    );
    await writeUnder(workDir, TASK_FOLDER_NAMES.screenshots, "shot.png");
    await writeUnder(workDir, TASK_FOLDER_NAMES.toolOutput, "part-1.log");
    await writeUnder(workDir, "src", "index.ts");
    await writeUnder(taskDirPath, TASK_FOLDER_NAMES.downloads, "report.pdf");

    // Excluded: node_modules (any depth), browser session + home.
    await writeUnder(workDir, "node_modules", "dep.js");
    await writeUnder(privateDir, TASK_FOLDER_NAMES.browserSession, "cookies");
    await writeUnder(privateDir, "agent-browser-home", ".agent-browser-config");

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
          "downloads/report.pdf",
          "work/.tool-output/part-1.log",
          "work/screenshots/shot.png",
          "work/src/index.ts",
        ]
      `);
  });
});

async function writeUnder(base: string, dir: string, file: string) {
  await fs.mkdir(path.join(base, dir), { recursive: true });
  await fs.writeFile(path.join(base, dir, file), "x");
}
