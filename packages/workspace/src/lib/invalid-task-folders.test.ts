import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  listInvalidTaskFolders,
  trashInvalidTaskFolder,
} from "./invalid-task-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

let rootDir: string;
let tasksDir: string;
let trashed: string[];

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "invalid-folders-"));
  tasksDir = path.join(rootDir, "tasks");
  trashed = [];

  // Seed a valid task so the mock config's tasksDir points at our temp dir.
  await fs.mkdir(path.join(tasksDir, "valid-task"), { recursive: true });
  createMockTaskConfigForDir(path.join(tasksDir, "valid-task"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    tasksDir: AbsolutePathSchema.parse(tasksDir),
    trashItem: (target: AbsolutePath) => {
      trashed.push(target);
      return Promise.resolve();
    },
  });
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("listInvalidTaskFolders", () => {
  it("returns only folders whose name isn't a valid task id", async () => {
    await fs.mkdir(path.join(tasksDir, "another-valid-task"));
    await fs.mkdir(path.join(tasksDir, "Has Spaces"));
    await fs.mkdir(path.join(tasksDir, "UPPERCASE"));
    await fs.mkdir(path.join(tasksDir, "has.dots"));

    const invalid = await listInvalidTaskFolders(getWorkspaceConfig());

    expect(invalid.map((folder) => folder.name).sort()).toEqual([
      "Has Spaces",
      "UPPERCASE",
      "has.dots",
    ]);
    expect(invalid.every((folder) => folder.reason.length > 0)).toBe(true);
  });

  it("returns an empty list when the tasks dir is missing", async () => {
    await fs.rm(tasksDir, { force: true, recursive: true });
    expect(await listInvalidTaskFolders(getWorkspaceConfig())).toEqual([]);
  });
});

describe("trashInvalidTaskFolder", () => {
  it("trashes an unrecognized folder", async () => {
    await fs.mkdir(path.join(tasksDir, "Has Spaces"));

    const result = await trashInvalidTaskFolder(
      "Has Spaces",
      getWorkspaceConfig(),
    );

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([path.join(tasksDir, "Has Spaces")]);
  });

  it("refuses to trash a valid task folder", async () => {
    const result = await trashInvalidTaskFolder(
      TaskIdSchema.parse("valid-task"),
      getWorkspaceConfig(),
    );

    expect(result.isErr()).toBe(true);
    expect(trashed).toEqual([]);
  });

  it("refuses path traversal outside the tasks dir", async () => {
    const result = await trashInvalidTaskFolder(
      "../escape",
      getWorkspaceConfig(),
    );

    expect(result.isErr()).toBe(true);
    expect(trashed).toEqual([]);
  });
});
