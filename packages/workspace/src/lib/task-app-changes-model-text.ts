import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_COMMAND } from "./shell-commands/app-command";
import { systemNote } from "./system-note";

/**
 * What changed about the apps this task may reach since the model last looked.
 *
 * An app arriving is the interesting half: the usual reason is that the task
 * asked for a service it had no way in to, and it has been waiting since. So
 * the note says how to use it rather than only that it is there.
 */
export function taskAppChangesModelNote(
  data: SessionMessageDataPart.TaskAppChangesDataPart,
): null | string {
  const lines: string[] = [];

  if (data.added.length > 0) {
    const added = data.added
      .map((app) => `- ${app.name} (${app.slug})`)
      .join("\n");
    lines.push(
      `You can now reach these apps through the \`${APP_COMMAND.name}\` command, alongside any your context already lists. This supersedes anything earlier in this conversation saying you could not:\n${added}\n\n\`${APP_COMMAND.name} tools <slug>\` lists an MCP app's tools with what each takes and \`${APP_COMMAND.name} call <slug> <tool> '<json>'\` runs one; \`${APP_COMMAND.name} request <slug> GET /path\` goes through an API app. The sign-in or key is stored by the app and injected for you. If this is what you were waiting on, carry on with it now.`,
    );
  }

  if (data.removed.length > 0) {
    const removed = data.removed
      .map((app) => `- ${app.name} (${app.slug})`)
      .join("\n");
    lines.push(
      `These apps are no longer yours to reach, and a call to one will be refused. Do not try again; finish with what you have and say what you could not do:\n${removed}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return systemNote`
    ${lines.join("\n\n")}
  `;
}
