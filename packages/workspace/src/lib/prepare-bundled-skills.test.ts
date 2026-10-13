import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { prepareBundledSkills } from "./prepare-bundled-skills";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prepare-skills-"));
  temporaryDirs.push(root);
  const config = {
    preparedSkillsDir: AbsolutePathSchema.parse(path.join(root, "prepared")),
    registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
    rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
  };
  return { config, root };
}

const listed = async (dir: string) =>
  (await fs.readdir(dir, { recursive: true })).toSorted();

describe("prepareBundledSkills", () => {
  it("copies both bundled sources into one folder, the system's copy winning a shared name", async () => {
    const { config } = await setup();
    await write(
      path.join(config.systemSkillsDir, "guide", "SKILL.md"),
      "system guide",
    );
    await write(
      path.join(config.systemSkillsDir, "shared", "SKILL.md"),
      "system",
    );
    await write(
      path.join(config.registryDir, "skills", "pdf", "SKILL.md"),
      "pdf",
    );
    await write(
      path.join(config.registryDir, "skills", "pdf", "scripts", "a.py"),
      "",
    );
    await write(
      path.join(config.registryDir, "skills", "shared", "SKILL.md"),
      "registry",
    );

    await prepareBundledSkills(config);

    expect(await listed(config.preparedSkillsDir)).toMatchInlineSnapshot(`
      [
        "guide",
        "guide/SKILL.md",
        "pdf",
        "pdf/SKILL.md",
        "pdf/scripts",
        "pdf/scripts/a.py",
        "shared",
        "shared/SKILL.md",
      ]
    `);
    expect(
      await fs.readFile(
        path.join(config.preparedSkillsDir, "shared", "SKILL.md"),
        "utf8",
      ),
    ).toBe("system");
  });

  it("replaces what an earlier launch prepared, so a skill the app dropped is gone", async () => {
    const { config } = await setup();
    await write(
      path.join(config.preparedSkillsDir, "dropped", "SKILL.md"),
      "old",
    );
    await write(path.join(config.systemSkillsDir, "guide", "SKILL.md"), "new");

    await prepareBundledSkills(config);

    expect(await listed(config.preparedSkillsDir)).toMatchInlineSnapshot(`
      [
        "guide",
        "guide/SKILL.md",
      ]
    `);
    expect(
      await listed(path.dirname(config.preparedSkillsDir)),
    ).not.toContainEqual(expect.stringMatching(/prepared\./));
  });

  it("prepares an empty folder when the bundled sources are missing", async () => {
    const { config } = await setup();

    await prepareBundledSkills(config);

    expect(await listed(config.preparedSkillsDir)).toEqual([]);
  });
});
