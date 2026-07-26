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
    expect(parseFrontmatter(make("description: Does a thing")))
      .toMatchInlineSnapshot(`
        {
          "body": "Body content",
          "compatibility": undefined,
          "description": "Does a thing",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
  });

  it("says which rejection happened", () => {
    expect({
      noDescription: parseFrontmatter(make("name: foo")),
      noFrontmatter: parseFrontmatter("Just plain content"),
      unterminated: parseFrontmatter("---\ndescription: Oops\nBody, no close"),
    }).toMatchInlineSnapshot(`
      {
        "noDescription": {
          "keys": [
            "name",
          ],
          "ok": false,
          "reason": "no-description",
        },
        "noFrontmatter": {
          "ok": false,
          "reason": "no-frontmatter",
        },
        "unterminated": {
          "ok": false,
          "reason": "unterminated",
        },
      }
    `);
  });

  it("gives the same reason every time it reads the same broken file", () => {
    const raw = make("description: [");
    expect([parseFrontmatter(raw), parseFrontmatter(raw)])
      .toMatchInlineSnapshot(`
        [
          {
            "detail": "Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 15",
            "ok": false,
            "reason": "unparseable",
          },
          {
            "detail": "Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 15",
            "ok": false,
            "reason": "unparseable",
          },
        ]
      `);
  });

  // A CRLF checkout is what a Windows build packages, and the closing fence
  // eats the `\n` of the last CRLF. Cover a quoted final value too: the stray
  // `\r` left behind is harmless inside an unquoted scalar but is a second
  // scalar after a closing quote, so quoting alone decided whether a skill was
  // discovered at all.
  it.each([
    { style: "unquoted", value: "Windows skill" },
    { style: "quoted", value: '"Windows skill"' },
  ])("handles Windows-style CRLF line endings ($style)", ({ value }) => {
    const raw = `---\r\ndescription: ${value}\r\n---\r\nBody`;
    expect(parseFrontmatter(raw)).toMatchInlineSnapshot(`
        {
          "body": "Body",
          "compatibility": undefined,
          "description": "Windows skill",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
  });

  it("falls back to sanitizer for description with colon (invalid YAML)", () => {
    expect(parseFrontmatter(make("description: Foo: bar baz")))
      .toMatchInlineSnapshot(`
        {
          "body": "Body content",
          "compatibility": undefined,
          "description": "Foo: bar baz",
          "keys": [
            "description",
          ],
          "modelInvocable": true,
          "ok": true,
          "title": undefined,
          "userInvocable": true,
        }
      `);
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
      const result = parseFrontmatter(raw);
      expect(result.ok && result.modelInvocable).toBe(expected);
    },
  );

  it.each([
    { expected: false, frontmatter: "user-invocable: false" },
    { expected: true, frontmatter: "user-invocable: true" },
    { expected: true, frontmatter: "" },
  ])(
    "reads userInvocable=$expected from `$frontmatter`",
    ({ expected, frontmatter }) => {
      const raw = make(
        ["description: Does a thing", frontmatter].filter(Boolean).join("\n"),
      );
      const result = parseFrontmatter(raw);
      expect(result.ok && result.userInvocable).toBe(expected);
    },
  );

  it("preserves extra frontmatter keys like argument-hint", () => {
    expect(
      parseFrontmatter(
        make(
          [
            "name: teach",
            "description: Teach the user a new skill or concept.",
            'argument-hint: "What would you like to learn about?"',
            "disable-model-invocation: true",
          ].join("\n"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "body": "Body content",
        "compatibility": undefined,
        "description": "Teach the user a new skill or concept.",
        "keys": [
          "name",
          "description",
          "argument-hint",
          "disable-model-invocation",
        ],
        "modelInvocable": false,
        "ok": true,
        "title": "teach",
        "userInvocable": true,
      }
    `);
  });

  it("trims leading/trailing whitespace from body", () => {
    const result = parseFrontmatter(
      `---\ndescription: Trimmed\n---\n\n  Body\n`,
    );
    expect(result.ok && result.body).toBe("Body");
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

    expect(files.sort()).toEqual([
      "SKILL.md",
      "package.json",
      "scripts/run.ts",
    ]);
  });
});

describe("skill discovery", () => {
  it("keeps every copy of a shared name and qualifies the ones that lose it", async () => {
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
      skills.map(({ description, qualifiedName, source }) => ({
        description,
        qualifiedName,
        source,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "description": "System",
          "qualifiedName": "creator",
          "source": "system",
        },
        {
          "description": "Bundled",
          "qualifiedName": "bundled",
          "source": "registry",
        },
        {
          "description": "Shared",
          "qualifiedName": "codex:review",
          "source": "codex",
        },
        {
          "description": "Workspace",
          "qualifiedName": "review",
          "source": "workspace",
        },
      ]
    `);
  });

  it("collapses copies of one skill that agree on SKILL.md", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-copies-"));
    temporaryDirs.push(root);
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");

    // What a tool that copies rather than symlinks leaves behind.
    for (const vendor of [".claude", ".cursor", ".gemini"]) {
      await writeSkill(path.join(home, vendor, "skills", "review"), "Shared");
    }
    await writeSkill(path.join(workspace, "skills", "review"), "Shared");
    await writeSkill(
      path.join(home, ".codex", "skills", "review"),
      "Different",
    );

    const skills = await findSkills(
      getSkillSources(
        {
          registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
          rootDir: WorkspaceDirSchema.parse(workspace),
          systemSkillsDir: AbsolutePathSchema.parse(path.join(root, "system")),
        },
        AbsolutePathSchema.parse(home),
      ),
    );

    // One entry for the four identical copies, attributed to the source that
    // outranks the rest, and the genuinely different one beside it.
    expect(
      skills.map(({ description, qualifiedName, source }) => ({
        description,
        qualifiedName,
        source,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "description": "Shared",
          "qualifiedName": "review",
          "source": "workspace",
        },
        {
          "description": "Different",
          "qualifiedName": "codex:review",
          "source": "codex",
        },
      ]
    `);
  });

  it("qualifies every claimant when the top-ranked source is a tie", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-tie-"));
    temporaryDirs.push(root);
    const home = path.join(root, "home");

    await writeSkill(path.join(home, ".claude", "skills", "review"), "Claude");
    await writeSkill(path.join(home, ".cursor", "skills", "review"), "Cursor");

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

    // Neither vendor directory outranks the other, so "review" alone addresses
    // nothing and both have to be asked for by source.
    expect(skills.map(({ qualifiedName }) => qualifiedName))
      .toMatchInlineSnapshot(`
      [
        "claude:review",
        "cursor:review",
      ]
    `);
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
