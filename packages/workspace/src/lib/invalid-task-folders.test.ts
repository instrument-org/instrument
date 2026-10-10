import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
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
  await fs.mkdir(path.join(tasksDir, "valid-task", ".instrument"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tasksDir, "valid-task", ".instrument", "settings.json"),
    JSON.stringify({ name: "Valid" }),
  );
  createMockChatConfigForDir(path.join(tasksDir, "valid-task"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    tasksDir: AbsolutePathSchema.parse(tasksDir),
    trashItem: (target: AbsolutePath) => {
      trashed.push(target);
      return Promise.resolve();
    },
  });
});

/** A task folder under `tasks/`, with these settings when there are any. */
async function taskFolder(name: string, settings?: string) {
  const dir = path.join(tasksDir, name);
  await fs.mkdir(path.join(dir, ".instrument"), { recursive: true });
  if (settings !== undefined) {
    await fs.writeFile(
      path.join(dir, ".instrument", "settings.json"),
      settings,
    );
  }
}

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("listInvalidTaskFolders", () => {
  it("returns only folders whose name isn't a valid task id", async () => {
    await taskFolder("another-valid-task", JSON.stringify({ name: "Another" }));
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

  it("returns a task whose settings are missing or unreadable, creating nothing in it", async () => {
    await taskFolder("2026-09-30-no-settings");
    await taskFolder("2026-09-30-truncated", '{"name": "Half');
    await taskFolder("2026-09-30-not-a-task", JSON.stringify({ name: 7 }));

    const invalid = await listInvalidTaskFolders(getWorkspaceConfig());

    expect(invalid.toSorted((a, b) => a.name.localeCompare(b.name)))
      .toMatchInlineSnapshot(`
      [
        {
          "name": "2026-09-30-no-settings",
          "reason": "Missing or unreadable settings (.instrument/settings.json)",
        },
        {
          "name": "2026-09-30-not-a-task",
          "reason": "Missing or unreadable settings (.instrument/settings.json)",
        },
        {
          "name": "2026-09-30-truncated",
          "reason": "Missing or unreadable settings (.instrument/settings.json)",
        },
      ]
    `);
    expect(
      await fs.readdir(
        path.join(tasksDir, "2026-09-30-no-settings", ".instrument"),
      ),
    ).toEqual([]);
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
      ChatIdSchema.parse("valid-task"),
      getWorkspaceConfig(),
    );

    expect(result.isErr()).toBe(true);
    expect(trashed).toEqual([]);
  });

  it("trashes a task whose settings cannot be read", async () => {
    await taskFolder("2026-09-30-truncated", '{"name": "Half');

    const result = await trashInvalidTaskFolder(
      "2026-09-30-truncated",
      getWorkspaceConfig(),
    );

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([path.join(tasksDir, "2026-09-30-truncated")]);
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
