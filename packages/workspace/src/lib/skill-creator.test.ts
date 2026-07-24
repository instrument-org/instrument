import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../tools/name";
import { VALIDATE_SKILL_COMMAND } from "./shell-commands/validate-skill";
import { parseFrontmatter } from "./skills";
import { SKILL_LIMITS } from "./validate-skill";
import { SKILLS_MOUNT_POINT } from "./workspace-fs-layout";

/**
 * The one skill we ship documents runtime facts as prose: the skills mount
 * point, the `load_skill` tool, the `validate-skill` command, and the SKILL.md
 * budgets. A rename or a bumped limit in the code would silently leave its
 * instructions wrong. Deriving the expected text from the same constants the
 * runtime uses makes that drift fail here instead of reaching a user.
 */
const SKILL_MD = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../system-skills/skill-creator/SKILL.md",
  ),
  "utf8",
);

describe("skill-creator system skill", () => {
  it("ships parseable, model-invocable frontmatter", () => {
    // A frontmatter break would drop the shipped skill from discovery with no
    // error -- the exact silent failure the skill warns its authors about.
    const parsed = parseFrontmatter(SKILL_MD);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.modelInvocable).toBe(true);
  });

  it.each([
    ["skills mount point", SKILLS_MOUNT_POINT],
    ["load_skill tool", TOOL_NAMES.loadSkill],
    ["validate-skill command", VALIDATE_SKILL_COMMAND.name],
    ["SKILL.md line budget", String(SKILL_LIMITS.skillFileLines)],
    ["SKILL.md token budget", String(SKILL_LIMITS.skillFileTokens)],
    ["skill name length limit", String(SKILL_LIMITS.nameChars)],
  ])("documents the %s using its constant", (_label, value) => {
    expect(SKILL_MD).toContain(value);
  });

  it("teaches the frontmatter key the parser still honors", () => {
    const key = "disable-model-invocation";
    // Prove the parser reads the key the doc teaches, so renaming it in the
    // parser can't leave the doc pointing at one nothing acts on.
    expect(SKILL_MD).toContain(key);
    const parsed = parseFrontmatter(
      `---\nname: x\ndescription: y\n${key}: true\n---\nbody`,
    );
    expect(parsed.ok && parsed.modelInvocable).toBe(false);
  });
});
