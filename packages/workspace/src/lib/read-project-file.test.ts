import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { readProjectFile } from "./read-project-file";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

describe("readProjectFile", () => {
  const subdomain = TaskIdSchema.parse("test-project");
  let tasksDir: string;
  let dir: string;

  beforeEach(async () => {
    tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-project-file-"));
    dir = path.join(tasksDir, subdomain);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "inside.txt"), "inside contents");
    // Sensitive file outside the task dir (sibling of dir under tasksDir).
    await fs.writeFile(path.join(tasksDir, "secret.txt"), "ssh private key");

    // createMockAppConfig publishes the singleton; point it at the temp dir so
    // readProjectFile (which reads the singleton) resolves under it.
    createMockAppConfig(subdomain);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      tasksDir: AbsolutePathSchema.parse(tasksDir),
    });
  });

  afterEach(async () => {
    await fs.rm(tasksDir, { force: true, recursive: true });
  });

  it("reads a file inside the task dir", async () => {
    const buffer = await readProjectFile({
      filePath: "inside.txt",
      projectSubdomain: subdomain,
    });
    expect(buffer?.toString("utf8")).toBe("inside contents");
  });

  it.each([
    { filePath: "../secret.txt", label: "parent traversal" },
    { filePath: "./sub/../../secret.txt", label: "nested traversal" },
    { filePath: "..\\secret.txt", label: "backslash traversal" },
    { filePath: "/etc/passwd", label: "absolute path" },
  ])("fails closed for $label", async ({ filePath }) => {
    const buffer = await readProjectFile({
      filePath,
      projectSubdomain: subdomain,
    });
    expect(buffer).toBeNull();
  });
});
