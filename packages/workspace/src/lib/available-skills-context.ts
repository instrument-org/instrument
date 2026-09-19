import { APP_NAME_SLUG } from "@instrument-org/shared";
import { dedent } from "radashi";

import { TOOL_NAMES } from "../tools/name";
import { renderSkillCatalog } from "./skill-catalog";
import { DELIVERABLE_SKILLS } from "./skill-names";
import { findSkills, getSkillSources, type SkillInfo } from "./skills";
import { getWorkspaceConfig } from "./workspace-config";

interface SkillsContextOptions {
  /**
   * Which skills are listed. `all` for the agent that loads skills, since it
   * may load any of them; `deliverables` for the agent that briefs tasks,
   * which is told only about the skills that make a thing a user asks for by
   * kind, and the ones the user wrote in this workspace, since those are the
   * only ones a brief has reason to name.
   */
  described?: "all" | "deliverables";
  /** Who loads a skill: the agent reading the catalog, or a task it briefs. */
  intro?: string;
}

/**
 * The budgeted skill catalog, rendered for the session's context message.
 *
 * This used to live in `load_skill`'s description, where it was rediscovered
 * for every request: installing, editing, or removing a skill rewrote a tool
 * definition near the front of the prompt and invalidated everything cached
 * behind it. Rendered here instead, it is written once per session and then
 * left alone, and a skill that appears later is announced as a correction on a
 * later turn rather than by rewriting this block.
 */
export async function buildAvailableSkillsContext(
  options: SkillsContextOptions = {},
) {
  const skills = await findSkills(getSkillSources(getWorkspaceConfig()));
  return renderAvailableSkillsContext(skills, options);
}

export function renderAvailableSkillsContext(
  skills: SkillInfo[],
  {
    described = "all",
    intro = `The skills installed on this machine when this session started. Load one with \`${TOOL_NAMES.loadSkill}\` by the exact name shown here.`,
  }: SkillsContextOptions = {},
) {
  const invocable = skills.filter((skill) => skill.modelInvocable);
  const listed =
    described === "all"
      ? invocable
      : invocable.filter(
          (skill) =>
            (skill.source === APP_NAME_SLUG &&
              DELIVERABLE_SKILLS.has(skill.name)) ||
            skill.source === "workspace",
        );
  const catalog = renderSkillCatalog(listed);

  const notes = [
    catalog.shortened > 0 &&
      `${catalog.shortened} description(s) were shortened to fit the skills context budget; a skill's full instructions come with loading it.`,
    catalog.omitted > 0 &&
      `${catalog.omitted} further skill(s) were left out of this list entirely. \`${TOOL_NAMES.loadSkill}\` still accepts them by name.`,
    // The agent that briefs is told the rest exist and no more: a name in
    // front of it is a name it puts in a brief.
    described === "deliverables" &&
      listed.length < invocable.length &&
      `A task has more skills than these, for ways of working (its browser, media, images, archives, code, and the like), and reaches for one itself when its work calls for it; they are not for a brief to name.`,
  ].filter((note) => typeof note === "string");

  return dedent`
    ${intro}

    ${catalog.xml}
    ${notes.length > 0 ? `\n${notes.join("\n")}` : ""}
  `.trim();
}
