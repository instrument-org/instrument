import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import {
  findSkills,
  getSkillSources,
  listSkillFiles,
  parseFrontmatter,
} from "./skills";

const make = (frontmatter: string, body = "Body content") =>
  `---\n${frontmatter}\n---\n${body}`;

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

describe("parseFrontmatter", () => {
  it("parses typical skill file", () => {
    const result = parseFrontmatter(make("description: Does a thing"));
    expect(result).toEqual({
      body: "Body content",
      description: "Does a thing",
      modelInvocable: true,
    });
  });

  it("returns null when description is missing", () => {
    expect(parseFrontmatter(make("name: foo"))).toBeNull();
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("Just plain content")).toBeNull();
  });

  it("handles Windows-style CRLF line endings", () => {
    const raw = "---\r\ndescription: Windows skill\r\n---\r\nBody";
    expect(parseFrontmatter(raw)).toEqual({
      body: "Body",
      description: "Windows skill",
      modelInvocable: true,
    });
  });

  it("falls back to sanitizer for description with colon (invalid YAML)", () => {
    const result = parseFrontmatter(make("description: Foo: bar baz"));
    expect(result).toEqual({
      body: "Body content",
      description: "Foo: bar baz",
      modelInvocable: true,
    });
  });

  it.each([
    { expected: false, frontmatter: "disable-model-invocation: true" },
    { expected: true, frontmatter: "disable-model-invocation: false" },
    { expected: true, frontmatter: "" },
  ])(
    "reads modelInvocable=$expected from `$frontmatter`",
    ({ expected, frontmatter }) => {
      const raw = make(
        ["description: Does a thing", frontmatter].filter(Boolean).join("\n"),
      );
      expect(parseFrontmatter(raw)?.modelInvocable).toBe(expected);
    },
  );

  it("trims leading/trailing whitespace from body", () => {
    const result = parseFrontmatter(
      `---\ndescription: Trimmed\n---\n\n  Body\n`,
    );
    expect(result?.body).toBe("Body");
  });
});

describe("listSkillFiles", () => {
  it("skips dependency trees and tool caches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-files-"));
    temporaryDirs.push(root);
    await fs.mkdir(path.join(root, "node_modules", "cac"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, ".turbo"), { recursive: true });
    await fs.mkdir(path.join(root, "scripts"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "cac", "index.js"), "");
    await fs.writeFile(path.join(root, ".turbo", "turbo-test.log"), "");
    await fs.writeFile(path.join(root, "scripts", "run.ts"), "");
    await fs.writeFile(path.join(root, "package.json"), "{}");
    await fs.writeFile(path.join(root, "SKILL.md"), make("description: X"));

    const { files } = await listSkillFiles(
      AbsolutePathSchema.parse(root),
      AbortSignal.timeout(5000),
    );

    expect(files.sort()).toEqual(["package.json", "scripts/run.ts"]);
  });
});

describe("skill discovery", () => {
  it("discovers symlinks and lets workspace skills override user skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
    temporaryDirs.push(root);
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    const registry = path.join(root, "registry");
    const systemSkills = path.join(root, "system-skills");
    const sharedSkill = path.join(root, "shared", "review");

    await writeSkill(path.join(systemSkills, "creator"), "System");
    await writeSkill(path.join(registry, "skills", "bundled"), "Bundled");
    await writeSkill(sharedSkill, "Shared");
    await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true });
    await fs.symlink(
      sharedSkill,
      path.join(home, ".codex", "skills", "review"),
    );
    await writeSkill(path.join(workspace, "skills", "review"), "Workspace");

    const sources = getSkillSources(
      {
        registryDir: AbsolutePathSchema.parse(registry),
        rootDir: WorkspaceDirSchema.parse(workspace),
        systemSkillsDir: AbsolutePathSchema.parse(systemSkills),
      },
      AbsolutePathSchema.parse(home),
    );
    const skills = await findSkills(sources);

    expect(
      skills.map(({ description, name, source }) => ({
        description,
        name,
        source,
      })),
    ).toEqual([
      { description: "System", name: "creator", source: "system" },
      { description: "Bundled", name: "bundled", source: "registry" },
      { description: "Workspace", name: "review", source: "workspace" },
    ]);
  });

  it("collapses one real skill reached through several symlinked sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-dedupe-"));
    temporaryDirs.push(root);
    const home = path.join(root, "home");
    const shared = path.join(root, "dotfiles", "skills");

    await writeSkill(path.join(shared, "review"), "Shared");
    // ~/.agents/skills is the symlink farm itself; the other vendors symlink
    // the individual skill, which is how these directories look in practice.
    await fs.mkdir(path.join(home, ".agents"), { recursive: true });
    await fs.symlink(shared, path.join(home, ".agents", "skills"));
    for (const vendor of [".claude", ".cursor", ".gemini"]) {
      await fs.mkdir(path.join(home, vendor, "skills"), { recursive: true });
      await fs.symlink(
        path.join(shared, "review"),
        path.join(home, vendor, "skills", "review"),
      );
    }

    const skills = await findSkills(
      getSkillSources(
        {
          registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
          rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
          systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
        },
        AbsolutePathSchema.parse(home),
      ),
    );

    expect(skills.map(({ name, source }) => ({ name, source }))).toEqual([
      { name: "review", source: "agents" },
    ]);
  });
});

async function writeSkill(dir: string, description: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    make(`description: ${description}`),
  );
}
