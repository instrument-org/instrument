import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_COMMAND } from "./shell-commands/app-command";
import { systemNote } from "./system-note";

/**
 * The note that wakes an orchestrator about an app: the user finished a
 * sign-in, saved a key, declined, or took an app away. What to do next is in
 * the note, since nobody typed anything and the agent has to know why it is
 * awake.
 */
export function appEventModelNote(
  data: SessionMessageDataPart.AppEventDataPart,
) {
  const lines = data.events.map((event) => {
    switch (event.event) {
      case "connected": {
        return `- The user signed in to ${event.name} (${event.slug}). It is connected${event.detail ? `: ${event.detail}` : ""}. Use it now: \`${APP_COMMAND.name} tools ${event.slug}\`, then \`${APP_COMMAND.name} call\`.`;
      }
      case "declined": {
        return `- The user declined to connect ${event.name} (${event.slug}). Do not ask again unless they bring it up; say what you cannot do without it, in a line, and carry on with what you can.`;
      }
      case "disconnected": {
        return `- ${event.name} (${event.slug}) was disconnected. Its tools and requests will refuse until it is connected again.`;
      }
      case "failed": {
        return `- Connecting ${event.name} (${event.slug}) failed${event.detail ? `: ${event.detail}` : ""}. Read \`${APP_COMMAND.name} list\`, fix what you can, and tell the user in a line what happened.`;
      }
      case "removed": {
        return `- ${event.name} (${event.slug}) was removed: its folder is gone along with its sign-in or key. Set it up again with \`${APP_COMMAND.name} new\` only if the user asks for it.`;
      }
    }
  });

  return systemNote`
    ${data.events.length === 1 ? "An app changed:" : "Apps changed:"}
    ${lines.join("\n")}
    Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this.
  `;
}
