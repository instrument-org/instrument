import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { type SkillInfo } from "./skills";
import { validateSkill } from "./validate-skill";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

/** Write a skill package and check it. */
async function reportFor(
  files: Record<string, string>,
  {
    installed = [],
    name = "test-skill",
  }: { installed?: SkillInfo[]; name?: string } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "validate-skill-"));
  temporaryDirs.push(root);
  const skillDir = path.join(root, name);

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(skillDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await fs.mkdir(skillDir, { recursive: true });

  return validateSkill({
    installed,
    signal: AbortSignal.timeout(5000),
    skillDir: AbsolutePathSchema.parse(skillDir),
    skillName: name,
  });
}

/** The rules that fired, as `level:rule`. */
async function rulesFor(...args: Parameters<typeof reportFor>) {
  const report = await reportFor(...args);
  return report.findings.map(({ level, rule }) => `${level}:${rule}`);
}

const good = [
  "---",
  "name: test-skill",
  "description: Convert a thing into another thing. Use when a user asks to convert things.",
  "---",
  "",
  "# Test skill",
  "",
  "Do the thing.",
].join("\n");

describe("validateSkill", () => {
  it("reports nothing for a well-formed skill", async () => {
    expect(await rulesFor({ "SKILL.md": good })).toMatchInlineSnapshot(`[]`);
  });

  it("reports a directory that is not a skill", async () => {
    expect(await rulesFor({ "notes.md": "hi" })).toMatchInlineSnapshot(`
      [
        "error:missing-skill-file",
      ]
    `);
  });

  it.each([
    {
      case: "unparseable",
      expected: "error:unparseable",
      raw: "---\ndescription: [\n---\nBody",
    },
    {
      case: "no description",
      expected: "error:no-description",
      raw: "---\nname: test-skill\n---\nBody",
    },
    {
      case: "no frontmatter",
      expected: "error:no-frontmatter",
      raw: "Just a document",
    },
    {
      case: "unterminated",
      expected: "error:unterminated",
      raw: "---\ndescription: Oops\nBody, no close",
    },
  ])(
    "reports frontmatter that hides the skill ($case)",
    async ({ expected, raw }) => {
      const rules = await rulesFor({ "SKILL.md": raw });
      expect(rules[0]).toBe(expected);
    },
  );

  it("points at the line the YAML broke on", async () => {
    const report = await reportFor({
      "SKILL.md": "---\ndescription: [\n---\nBody",
    });
    const finding = report.findings.find((f) => f.rule === "unparseable");
    expect(finding?.message).toContain("line 2, column 15");
  });

  it("reports what load_skill would refuse", async () => {
    expect(
      await rulesFor({
        "package.json": "{ not json",
        "SKILL.md": good,
      }),
    ).toMatchInlineSnapshot(`
      [
        "error:load-would-fail",
      ]
    `);
  });

  it("reports python dependencies with no lockfile", async () => {
    expect(
      await rulesFor({
        "pyproject.toml": "[project]\nname = 'x'\n",
        "SKILL.md": good,
      }),
    ).toMatchInlineSnapshot(`
      [
        "error:load-would-fail",
      ]
    `);
  });

  it("warns about angle brackets the catalog would render literally", async () => {
    expect(
      await rulesFor({
        "SKILL.md": good.replace("another thing.", "a <thing>."),
      }),
    ).toMatchInlineSnapshot(`
      [
        "warning:description-angle-brackets",
      ]
    `);
  });

  it("reports authoring rules the runtime tolerates", async () => {
    expect(
      await rulesFor(
        {
          "SKILL.md": [
            "---",
            "name: Something Else",
            "description: Does a thing. Use when asked.",
            "disable_model_invocation: true",
            "---",
            "",
            "Run [the script](scripts/missing.ts).",
            "See tests/ for examples.",
          ].join("\n"),
        },
        { name: "Test_Skill" },
      ),
    ).toMatchInlineSnapshot(`
      [
        "warning:unknown-frontmatter-key",
        "warning:name-mismatch",
        "warning:name-not-kebab-case",
        "warning:missing-reference",
        "warning:reference-not-copied",
      ]
    `);
  });

  it("finds a reference that does exist", async () => {
    expect(
      await rulesFor({
        "scripts/run.ts": "export {};",
        "SKILL.md": `${good}\n\nRun [it](scripts/run.ts).`,
      }),
    ).toMatchInlineSnapshot(`[]`);
  });

  it("reports a name another skill has already claimed", async () => {
    const other: SkillInfo = {
      content: "body",
      description: "A different skill with the same name.",
      modelInvocable: true,
      name: "test-skill",
      skillDir: AbsolutePathSchema.parse("/elsewhere/test-skill"),
      source: "claude",
      title: "test-skill",
    };
    expect(await rulesFor({ "SKILL.md": good }, { installed: [other, other] }))
      .toMatchInlineSnapshot(`
      [
        "warning:duplicate-name",
      ]
    `);
  });
});
