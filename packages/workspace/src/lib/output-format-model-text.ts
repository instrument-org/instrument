import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { SKILL_NAMES } from "./skill-names";
import { systemNote } from "./system-note";

/**
 * The kind of page the user asked to receive the response as, picked on the
 * draft that opened the thread. It names a template of the page skill, so
 * the brief says to load that skill by name and build from that template
 * rather than describing the page; the words are the user's own choice, so
 * a reply in the chat alone is not what they asked for.
 */
export function outputFormatModelNote(
  data: SessionMessageDataPart.OutputFormatDataPart,
) {
  return systemNote`
    The user picked how the response should come back: as a ${data.title} page, the \`${SKILL_NAMES.createPage}\` skill's \`templates/${data.name}/template.md\`. Have the task load \`${SKILL_NAMES.createPage}\` by name and make the page from that template, in the workspace folder, and hand the file over in your reply.
  `;
}
