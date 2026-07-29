import { describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { getSkillProvenance } from "./skill-provenance";
import { type SkillSourceKind } from "./skills";

const writableRoot = "/workspace/skills";

describe("getSkillProvenance", () => {
  it.each([
    {
      expected: {
        editable: true,
        installDependencies: true,
        origin: "workspace",
      },
      name: "writable workspace skill",
      skillDir: "/workspace/skills/review",
      source: "workspace",
    },
    {
      expected: {
        editable: false,
        installDependencies: true,
        origin: "in-repo",
      },
      name: "in-repo skill",
      skillDir: "/workspace/.agents/skills/review",
      source: "workspace",
    },
    {
      expected: {
        editable: false,
        installDependencies: true,
        origin: "instrument",
      },
      name: "provided skill",
      skillDir: "/app/skills/review",
      source: "instrument",
    },
    {
      expected: {
        editable: false,
        installDependencies: false,
        origin: "external",
      },
      name: "external skill",
      skillDir: "/home/.claude/skills/review",
      source: "claude",
    },
  ] satisfies {
    expected: ReturnType<typeof getSkillProvenance>;
    name: string;
    skillDir: string;
    source: SkillSourceKind;
  }[])("$name", ({ expected, skillDir, source }) => {
    expect(
      getSkillProvenance(
        { skillDir: AbsolutePathSchema.parse(skillDir), source },
        writableRoot,
      ),
    ).toEqual(expected);
  });
});
