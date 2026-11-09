import { APP_NAME } from "@instrument-org/shared";
import { PROJECT_FILE_NAME, PROJECTS_FOLDER_NAME } from "../../constants";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { instructionsInContext } from "../../lib/instructions-in-context";
import { systemNote } from "./system-note";

/**
 * Tells the agent which project this chat is filed under: its name, its mark,
 * and the line saying what belongs there, then its instructions and
 * folders. Rendered only when it differs from the last note, so a chat
 * filed once is told once, and told again when the user changes the
 * project's instructions or folders.
 */
export function projectModelNote({
  project,
}: SessionMessageDataPart.ProjectDataPart) {
  if (project === null) {
    return systemNote`
      This chat has no project now.
    `;
  }
  const mark = project.emoji ? `${project.emoji} ` : "";
  const about = project.about ? ` (${project.about})` : "";
  const instructions = instructionsInContext({
    file: `${PROJECTS_FOLDER_NAME}/${project.name}/${PROJECT_FILE_NAME}`,
    instructions: project.instructions,
  });
  const standing = [
    ...(instructions
      ? [
          `What every chat under "${project.name}" is told, from its ${PROJECT_FILE_NAME}:\n<project_instructions>\n${instructions}\n</project_instructions>`,
        ]
      : []),
    ...(project.folders?.length
      ? [
          `Folders the work under "${project.name}" uses, attached to this chat: ${project.folders.map((folder) => `\`${folder}\``).join(", ")}.`,
        ]
      : []),
  ];
  const filed = `This chat is filed under the project ${mark}"${project.name}"${about}; read the chat through it. Its folder, \`${PROJECTS_FOLDER_NAME}/${project.name}/\` in the user's ${APP_NAME} folder, is where a finished file the user gave no place for goes, and its ${PROJECT_FILE_NAME} is where what every chat under it should know goes.`;
  return systemNote`
    ${[filed, ...standing].join("\n\n")}
  `;
}
