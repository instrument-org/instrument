import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { ProjectSubdomainSchema } from "../schemas/subdomains";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { readProjectFile } from "./read-project-file";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

describe("readProjectFile", () => {
  const subdomain = ProjectSubdomainSchema.parse("test-project");
  let projectsDir: string;
  let appDir: string;

  beforeEach(async () => {
    projectsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "read-project-file-"),
    );
    appDir = path.join(projectsDir, subdomain);
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(path.join(appDir, "inside.txt"), "inside contents");
    // Sensitive file outside the task dir (sibling of appDir under projectsDir).
    await fs.writeFile(path.join(projectsDir, "secret.txt"), "ssh private key");

    // createMockAppConfig publishes the singleton; point it at the temp dir so
    // readProjectFile (which reads the singleton) resolves under it.
    createMockAppConfig(subdomain);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      projectsDir: AbsolutePathSchema.parse(projectsDir),
    });
  });

  afterEach(async () => {
    await fs.rm(projectsDir, { force: true, recursive: true });
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
