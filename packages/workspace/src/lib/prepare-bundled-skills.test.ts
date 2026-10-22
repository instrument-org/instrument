import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { prepareBundledSkills } from "./prepare-bundled-skills";
import { runtimeLayout } from "./runtime-dir";

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
    registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
    rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    runtimeDir: AbsolutePathSchema.parse(path.join(root, "runtime")),
    systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
  };
  return { config, prepared: runtimeLayout(config.runtimeDir).skills };
}

/** Every entry under `dir`, spelled with `/` on every platform. */
const listed = async (dir: string) =>
  (await fs.readdir(dir, { recursive: true }))
    .map((entry) => entry.replaceAll(path.sep, "/"))
    .toSorted();

describe("prepareBundledSkills", () => {
  it("copies both bundled sources into one folder, the system's copy winning a shared name", async () => {
    const { config, prepared } = await setup();
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

    expect(await listed(prepared)).toMatchInlineSnapshot(`
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
      await fs.readFile(path.join(prepared, "shared", "SKILL.md"), "utf8"),
    ).toBe("system");
  });

  it("replaces what an earlier launch prepared, so a skill the app dropped is gone", async () => {
    const { config, prepared } = await setup();
    await write(path.join(prepared, "dropped", "SKILL.md"), "old");
    await write(path.join(config.systemSkillsDir, "guide", "SKILL.md"), "new");

    await prepareBundledSkills(config);

    expect(await listed(prepared)).toMatchInlineSnapshot(`
      [
        "guide",
        "guide/SKILL.md",
      ]
    `);
    expect(await listed(path.dirname(prepared))).not.toContainEqual(
      expect.stringMatching(/skills\./),
    );
  });

  it("copies what a skill links to, so the prepared folder needs nothing outside it", async () => {
    const { config, prepared } = await setup();
    const store = path.join(path.dirname(config.registryDir), "store");
    await write(path.join(store, "lib", "index.js"), "linked");
    const skill = path.join(config.registryDir, "skills", "pdf");
    await write(path.join(skill, "SKILL.md"), "pdf");
    await fs.symlink(path.join(store, "lib"), path.join(skill, "lib"));

    await prepareBundledSkills(config);

    const copied = path.join(prepared, "pdf", "lib");
    expect((await fs.lstat(copied)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(copied, "index.js"), "utf8")).toBe(
      "linked",
    );
  });

  it("skips what a skills working copy's tooling leaves, keeping the dotfiles a skill ships", async () => {
    const { config, prepared } = await setup();
    const skill = path.join(config.registryDir, "skills", "pdf");
    await write(path.join(skill, "SKILL.md"), "pdf");
    await write(path.join(skill, ".python-version"), "3.12");
    await write(path.join(skill, "scripts", "a.py"), "");
    await write(path.join(skill, "scripts", "__pycache__", "a.pyc"), "");
    await write(path.join(skill, ".venv", "bin", "python"), "");
    await write(path.join(skill, "node_modules", "x", "index.js"), "");
    await write(path.join(skill, ".pytest_cache", "README.md"), "");

    await prepareBundledSkills(config);

    expect(await listed(prepared)).toMatchInlineSnapshot(`
      [
        "pdf",
        "pdf/.python-version",
        "pdf/SKILL.md",
        "pdf/scripts",
        "pdf/scripts/a.py",
      ]
    `);
  });

  it("prepares an empty folder when the bundled sources are missing", async () => {
    const { config, prepared } = await setup();

    await prepareBundledSkills(config);

    expect(await listed(prepared)).toEqual([]);
  });
});
