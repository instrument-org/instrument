import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { describeHoldings } from "./describe-holdings";
import { taskFolderHoldings } from "./folder-holdings";

let tmpDir: string;
let taskRoot: string;
let taskId: TaskId;

async function touch(...segments: string[]) {
  const file = path.join(taskRoot, ...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "folder-holdings-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("taskFolderHoldings", () => {
  it("counts each folder's files and the files at the root, dot entries left out", async () => {
    await touch("work", "build.mjs");
    await touch("work", "out", "digest.html");
    await touch("attachments", "brief.docx");
    await touch("notes.md");
    await touch(".gitignore");
    await touch(".instrument", "task.db");
    await touch(".tool-output", "bash-1.log");

    expect(await taskFolderHoldings(taskId)).toEqual([
      { files: 1, name: "attachments/" },
      { files: 2, name: "work/" },
      { files: 1, name: "." },
    ]);
  });

  it("leaves out what is not the task's own: skill copies, node_modules, a repository's history", async () => {
    await touch("work", "skills", "instrument", "create-page", "SKILL.md");
    await touch("work", "repo", ".git", "HEAD");
    await touch("work", "repo", "README.md");
    await touch("work", "node_modules", "left-pad", "index.js");

    expect(await taskFolderHoldings(taskId)).toEqual([
      { files: 1, name: "work/" },
    ]);
  });

  it("holds nothing when only empty folders are there", async () => {
    await fs.mkdir(path.join(taskRoot, "attachments"));
    expect(await taskFolderHoldings(taskId)).toEqual([]);
  });
});

describe("describeHoldings", () => {
  it("reads as one clause", () => {
    expect(
      describeHoldings([
        { files: 57_717, name: "work/" },
        { files: 1, name: "attachments/" },
        { files: 2, name: "." },
      ]),
    ).toMatchInlineSnapshot(
      `"work/ 57,717 files, attachments/ 1 file, 2 files at the root"`,
    );
    expect(
      describeHoldings([{ capped: true, files: 100_000, name: "work/" }]),
    ).toMatchInlineSnapshot(`"work/ at least 100,000 files"`);
    expect(describeHoldings([])).toMatchInlineSnapshot(`"nothing of its own"`);
  });
});
