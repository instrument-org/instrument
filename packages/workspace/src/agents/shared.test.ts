import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { withTempDir } from "../test/helpers/temp-dir";
import { getTaskLayoutContext } from "./shared";

const root = withTempDir("task-layout");

describe("getTaskLayoutContext", () => {
  let taskDir: string;

  beforeEach(async () => {
    createMockTaskConfig(TaskIdSchema.parse("task-layout"));
    const templateDir = path.join(root.path, "template");
    await fs.mkdir(templateDir);
    for (const name of [".gitignore", "package.json"]) {
      await fs.writeFile(path.join(templateDir, name), "");
    }
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      defaultTaskTemplateDir: AbsolutePathSchema.parse(templateDir),
    });

    taskDir = path.join(root.path, "task");
    await fs.mkdir(taskDir);
    for (const name of [".gitignore", "package.json"]) {
      await fs.copyFile(path.join(templateDir, name), path.join(taskDir, name));
    }
    for (const folder of [
      TASK_FOLDER_NAMES.attachments,
      TASK_FOLDER_NAMES.output,
      TASK_FOLDER_NAMES.work,
    ]) {
      await fs.mkdir(path.join(taskDir, folder));
    }
  });

  // The prompt already describes the folders every task starts with, so a
  // tree of nothing else says it twice.
  it("says nothing for a task holding only the scaffold", async () => {
    await expect(
      getTaskLayoutContext(AbsolutePathSchema.parse(taskDir)),
    ).resolves.toBe("");
  });

  it("shows the tree once the task holds something of its own", async () => {
    await fs.writeFile(
      path.join(taskDir, TASK_FOLDER_NAMES.attachments, "brief.pdf"),
      "",
    );
    const text = await getTaskLayoutContext(AbsolutePathSchema.parse(taskDir));
    expect(text).toContain("<task_layout>");
    expect(text).toContain("brief.pdf");
  });
});
