import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_NAME } from "@instrument-org/shared";

import { APP_COMMAND } from "./shell-commands/app-command";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";

/**
 * The note about an app: on its own, it wakes the chat that asked, because
 * the user finished a sign-in, saved a key, or declined, and says what to do
 * next, since nobody typed anything; carried on a message the user wrote, it
 * says what changed outside the conversation, and only that.
 */
export function appEventModelNote(
  data: SessionMessageDataPart.AppEventDataPart,
) {
  const lines = data.events.map((event) => {
    // The detail is a sentence of the app's own where it has one, so the
    // period the clause around it ends with is already there.
    const detail = event.detail?.replace(/\.$/, "");
    switch (event.event) {
      case "connected": {
        if (event.web !== undefined) {
          return `- The user says they are signed in to ${event.name} (${event.slug}) on the web, in ${APP_NAME}'s browser. It is connected. Work it there: brief a task with ${event.web}, which it opens in a tab of its own where the sign-in holds, or hand it a tab already open there with \`${TASK_COMMAND.name} new --tab <id>\`. No \`${APP_COMMAND.name}\` call reaches it.${nameIt(event)}`;
        }
        return `- The user signed in to ${event.name} (${event.slug}). It is connected${detail ? `: ${detail}` : ""}. Use it now: \`${APP_COMMAND.name} tools ${event.slug}\`, then \`${APP_COMMAND.name} call\`.${nameIt(event)}`;
      }
      case "declined": {
        return `- The user declined to connect ${event.name} (${event.slug}). Do not ask again unless they bring it up; say what you cannot do without it, in a line, and carry on with what you can.`;
      }
      case "disconnected": {
        return event.web === undefined
          ? `- ${event.name} (${event.slug}) was disconnected. Its tools and requests will refuse until it is connected again.`
          : `- ${event.name} (${event.slug}) was disconnected. Do not work its site until the user signs in again.`;
      }
      case "failed": {
        return `- Connecting ${event.name} (${event.slug}) failed${detail ? `: ${detail}` : ""}. Read \`${APP_COMMAND.name} list\`, fix what you can, and tell the user in a line what happened.`;
      }
      case "removed": {
        return `- ${event.name} (${event.slug}) was removed: its folder is gone along with its sign-in or key. Set it up again with \`${APP_COMMAND.name} new\` only if the user asks for it.`;
      }
    }
  });

  return systemNote`
    ${data.events.length === 1 ? "An app changed:" : "Apps changed:"}
    ${lines.join("\n")}
    ${
      data.carried
        ? "This changed outside the conversation since your last turn. It is only so you know: answer what the user wrote."
        : "Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this."
    }
  `;
}

/**
 * Whose account the app is signed in as, when that is known, or what a
 * connection note asks of the agent once it can see it.
 */
function nameIt({ account, slug }: { account?: string; slug: string }): string {
  if (account !== undefined) {
    return ` It is signed in as ${account}.`;
  }
  return ` Once you see which account it is (an email address, a workspace), name it with \`${APP_COMMAND.name} account ${slug} '<account>'\`, so it can be told from another.`;
}
