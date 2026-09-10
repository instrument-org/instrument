import { APP_NAME_SLUG } from "@instrument-org/shared";
import { dedent } from "radashi";

import { TOOL_NAMES } from "../tools/name";
import { renderSkillCatalog } from "./skill-catalog";
import {
  findSkills,
  getSkillSources,
  type SkillInfo,
  type SkillSourceKind,
} from "./skills";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The sources whose skills the product stands behind: what it ships, and what
 * the user wrote in this workspace. A brief names one of these by what it
 * makes, so its description has to be in front of the agent writing the brief.
 * A skill another agent left in its home directory is named only when the
 * user names it, which its name alone serves.
 */
const OWN_SOURCES = new Set<SkillSourceKind>([
  APP_NAME_SLUG,
  "system",
  "workspace",
]);

interface SkillsContextOptions {
  /**
   * Which skills get their description. `all` for the agent that loads
   * skills, since it may load any of them; `ours` for the agent that briefs
   * tasks, which lists the rest by name alone.
   */
  described?: "all" | "ours";
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
  const withDescription =
    described === "all"
      ? invocable
      : invocable.filter((skill) => OWN_SOURCES.has(skill.source));
  const byNameOnly = invocable.filter(
    (skill) => !withDescription.includes(skill),
  );
  const catalog = renderSkillCatalog(withDescription);

  const notes = [
    catalog.shortened > 0 &&
      `${catalog.shortened} description(s) were shortened to fit the skills context budget; a skill's full instructions come with loading it.`,
    catalog.omitted > 0 &&
      `${catalog.omitted} further skill(s) were left out of this list entirely. \`${TOOL_NAMES.loadSkill}\` still accepts them by name.`,
    byNameOnly.length > 0 &&
      `Also installed, from other agents on this machine, and loaded the same way when the user asks for one by name: ${byNameOnly
        .map((skill) => skill.id)
        .sort()
        .join(", ")}.`,
  ].filter((note) => typeof note === "string");

  return dedent`
    ${intro}

    ${catalog.xml}
    ${notes.length > 0 ? `\n${notes.join("\n")}` : ""}
  `.trim();
}
