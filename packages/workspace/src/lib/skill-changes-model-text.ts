import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { TOOL_NAMES } from "../tools/name";
import { systemNote } from "./system-note";

/**
 * Tells the model which workspace skills it wrote since the session's skill
 * catalog was rendered.
 *
 * The catalog is a startup snapshot and is never rewritten, so a skill the
 * agent authors mid-session would otherwise be absent from everything the model
 * can see. This names only what the turn changed: it is a correction to the
 * catalog, not a replacement for it, and rescanning here would put the whole
 * catalog back in the request on every skill edit -- the cost the snapshot
 * exists to avoid.
 */
export function skillChangesModelNote(
  data: SessionMessageDataPart.SkillChangesDataPart,
): null | string {
  const created = [...data.created].sort();
  // A skill created and then revised in the same stretch is news as a creation;
  // saying both would describe one skill twice.
  const updated = data.updated.filter((name) => !created.includes(name)).sort();

  if (created.length === 0 && updated.length === 0) {
    return null;
  }

  const sentences = [
    created.length > 0 &&
      `You added ${nameList(created)} to the workspace skills folder, so ${created.length > 1 ? "they are" : "it is"} not in the skill catalog above.`,
    updated.length > 0 &&
      `You changed ${nameList(updated)} in the workspace skills folder, so any catalog entry above describes an older version.`,
  ].filter((sentence) => typeof sentence === "string");

  return systemNote`
    ${sentences.join(" ")} \`${TOOL_NAMES.loadSkill}\` accepts these names; load one to work from its current instructions rather than from what you remember writing.
  `;
}

function nameList(names: string[]) {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length === 1) {
    return `the skill ${quoted.join("")}`;
  }
  const last = quoted.pop() ?? "";
  return `the skills ${quoted.join(", ")} and ${last}`;
}
