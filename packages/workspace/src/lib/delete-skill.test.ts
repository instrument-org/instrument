import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { deleteSkill } from "./delete-skill";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

describe("deleteSkill", () => {
  it("deletes a workspace skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "delete-skill-"));
    temporaryDirs.push(root);
    const workspace = path.join(root, "workspace");
    const skillDir = path.join(workspace, "skills", "review");
    await writeSkill(skillDir, "Workspace");

    const result = await deleteSkill(
      {
        registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
        rootDir: WorkspaceDirSchema.parse(workspace),
        systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
      },
      "review",
    );

    expect(result.isOk()).toBe(true);
    await expect(fs.stat(skillDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to delete a non-workspace skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "delete-skill-"));
    temporaryDirs.push(root);
    const registrySkillDir = path.join(root, "registry", "skills", "review");
    await writeSkill(registrySkillDir, "Bundled");

    const result = await deleteSkill(
      {
        registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
        rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
        systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
      },
      "review",
    );

    expect(result.isErr() && result.error.message).toContain("is not editable");
    await expect(fs.stat(registrySkillDir)).resolves.toBeTruthy();
  });
});

async function writeSkill(dir: string, description: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\ndescription: ${description}\n---\nBody content`,
  );
}
