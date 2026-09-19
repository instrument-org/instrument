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
  skill("agent-browser", "Drive a browser.", "instrument"),
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
        <skill name="instrument:agent-browser">Drive a browser.</skill>
        <skill name="instrument:pdf">Work with PDF files.</skill>
        <skill name="cursor:commit-message">Generate a commit message.</skill>
        <skill name="agents:vitest">Vitest API and config reference.</skill>
      </available_skills>"
    `);
  });

  // The agent that briefs tasks is told about the skills that make a thing a
  // user asks for by kind, and the user's own; a way of working like the
  // browser is the task's to reach for, and a name in front of the briefing
  // agent is a name it puts in a brief.
  it("lists only the deliverable and workspace skills for the agent that briefs", () => {
    expect(
      renderAvailableSkillsContext(skills, {
        described: "deliverables",
        intro: "Skills a task can load.",
      }),
    ).toMatchInlineSnapshot(`
      "Skills a task can load.

      <available_skills>
        <skill name="workspace:house-style">Write the way we write.</skill>
        <skill name="instrument:pdf">Work with PDF files.</skill>
      </available_skills>

      A task has more skills than these, for ways of working (its browser, media, images, archives, code, and the like), and reaches for one itself when its work calls for it; they are not for a brief to name."
    `);
  });
});
