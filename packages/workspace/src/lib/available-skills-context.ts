import { dedent } from "radashi";

import { TOOL_NAMES } from "../tools/name";
import { renderSkillCatalog } from "./skill-catalog";
import { findSkills, getSkillSources } from "./skills";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The budgeted skill catalog, rendered for the session's context message.
 *
 * This used to live in `load_skill`'s description, where it was rediscovered
 * for every request: installing, editing, or removing a skill rewrote a tool
 * definition near the front of the prompt and invalidated everything cached
 * behind it. Rendered here instead, it is written once per session and then
 * left alone, and a skill that appears later is announced as a correction on a
 * later turn rather than by rewriting this block.
 *
 * `intro` says who loads a skill: the agent reading the catalog, or a task it
 * briefs. The catalog itself is the same either way.
 */
export async function buildAvailableSkillsContext({
  intro = `The skills installed on this machine when this session started. Load one with \`${TOOL_NAMES.loadSkill}\` by the exact name shown here.`,
}: { intro?: string } = {}) {
  const skills = await findSkills(getSkillSources(getWorkspaceConfig()));
  const catalog = renderSkillCatalog(
    skills.filter((skill) => skill.modelInvocable),
  );

  const budgetNotes = [
    catalog.shortened > 0 &&
      `${catalog.shortened} description(s) were shortened to fit the skills context budget; a skill's full instructions come with loading it.`,
    catalog.omitted > 0 &&
      `${catalog.omitted} further skill(s) were left out of this list entirely. \`${TOOL_NAMES.loadSkill}\` still accepts them by name.`,
  ].filter((note) => typeof note === "string");

  return dedent`
    ${intro}

    ${catalog.xml}
    ${budgetNotes.length > 0 ? `\n${budgetNotes.join("\n")}` : ""}
  `.trim();
}
