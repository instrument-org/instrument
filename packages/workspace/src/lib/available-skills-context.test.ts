import { describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { renderAvailableSkillsContext } from "./available-skills-context";
import { type SkillInfo, type SkillSourceKind } from "./skills";

const skill = (
  name: string,
  description: string,
  source: SkillSourceKind,
  modelInvocable = true,
): SkillInfo => ({
  aliases: [`${source}:${name}`],
  compatibility: undefined,
  content: "body",
  description,
  id: `${source}:${name}`,
  modelInvocable,
  name,
  qualifiedName: `${source}:${name}`,
  skillDir: AbsolutePathSchema.parse(`/skills/${source}/${name}`),
  source,
  sourceId: source === "workspace" ? "workspace" : source,
  title: name,
  userInvocable: true,
});

const skills = [
  skill("pdf", "Work with PDF files.", "instrument"),
  skill("skill-creator", "Create a reusable skill.", "system"),
  skill("house-style", "Write the way we write.", "workspace"),
  skill("vitest", "Vitest API and config reference.", "agents"),
  skill("commit-message", "Generate a commit message.", "cursor"),
  skill("hidden", "Never offered to the model.", "instrument", false),
];

describe("renderAvailableSkillsContext", () => {
  it("describes every skill the model may load", () => {
    expect(renderAvailableSkillsContext(skills)).toMatchInlineSnapshot(`
      "The skills installed on this machine when this session started. Load one with \`load_skill\` by the exact name shown here.

      <available_skills>
        <skill name="system:skill-creator">Create a reusable skill.</skill>
        <skill name="workspace:house-style">Write the way we write.</skill>
        <skill name="instrument:pdf">Work with PDF files.</skill>
        <skill name="cursor:commit-message">Generate a commit message.</skill>
        <skill name="agents:vitest">Vitest API and config reference.</skill>
      </available_skills>"
    `);
  });

  // The agent that briefs tasks names a shipped skill by what it makes, which
  // takes its description, and a skill from another agent's home only when
  // the user names it, which takes its name.
  it("lists other agents' skills by name alone for the agent that briefs", () => {
    expect(
      renderAvailableSkillsContext(skills, {
        described: "ours",
        intro: "Skills a task can load.",
      }),
    ).toMatchInlineSnapshot(`
      "Skills a task can load.

      <available_skills>
        <skill name="system:skill-creator">Create a reusable skill.</skill>
        <skill name="workspace:house-style">Write the way we write.</skill>
        <skill name="instrument:pdf">Work with PDF files.</skill>
      </available_skills>

      Also installed, from other agents on this machine, and loaded the same way when the user asks for one by name: agents:vitest, cursor:commit-message."
    `);
  });
});
