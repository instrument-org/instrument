import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { ACTIVITY_COMMAND } from "./shell-commands/activity-command";
import { systemNote } from "./system-note";

type Row = SessionMessageDataPart.ActionsDataPart["rows"][number];

/** A count of things: `1 file`, `3 files`. */
function things(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** One phrase saying what kind of thing was done and how many, never to what. */
function actionPhrase({ count, kind }: Pick<Row, "count" | "kind">) {
  const one = count === 1;
  switch (kind) {
    case "folder": {
      return one
        ? "opened a folder in Files"
        : `opened ${things(count, "folder")} in Files`;
    }
    case "file": {
      return one ? "opened a file" : `opened ${things(count, "file")}`;
    }
    case "open-with": {
      return one
        ? "opened a file in another app"
        : `opened ${things(count, "file")} in another app`;
    }
    case "edit": {
      return one ? "edited a file" : `edited ${things(count, "file")}`;
    }
    case "move": {
      return `moved ${things(count, "file")}`;
    }
    case "copy": {
      return `copied ${things(count, "file")}`;
    }
    case "rename": {
      return one ? "renamed a file" : `renamed ${things(count, "file")}`;
    }
    case "trash": {
      return `moved ${things(count, "file")} to the Trash`;
    }
    case "new-folder": {
      return one ? "made a folder" : `made ${things(count, "folder")}`;
    }
    case "chat": {
      return one ? "opened another chat" : `opened ${count} other chats`;
    }
    case "page": {
      return one ? "visited a page" : `visited ${things(count, "page")}`;
    }
    case "download": {
      return one ? "downloaded a file" : `downloaded ${things(count, "file")}`;
    }
    case "app-signed-in": {
      return one ? "signed in to an app" : `signed in to ${count} apps`;
    }
    case "app-disconnected": {
      return one ? "disconnected an app" : `disconnected ${count} apps`;
    }
    case "app-sign-in-failed": {
      return one
        ? "couldn't sign in to an app"
        : `couldn't sign in to ${count} apps`;
    }
    case "update": {
      return one ? `updated ${APP_NAME}` : `updated ${APP_NAME} ${count} times`;
    }
    case "permission-allowed-folder": {
      return one
        ? "allowed a chat to use a folder"
        : `allowed chats to use ${things(count, "folder")}`;
    }
    case "permission-allowed-app": {
      return one
        ? "allowed a chat to use an app"
        : `allowed chats to use ${things(count, "app")}`;
    }
    case "permission-refused-folder": {
      return one
        ? "refused a chat a folder"
        : `refused chats ${things(count, "folder")}`;
    }
    case "permission-refused-app": {
      return one
        ? "refused a chat an app"
        : `refused chats ${things(count, "app")}`;
    }
    case "error": {
      return one ? "saw an error" : `saw ${things(count, "error")}`;
    }
    case "setting": {
      return one ? "changed a setting" : `changed ${things(count, "setting")}`;
    }
  }
}

/** The note's rows as the model reads them, without their dashes: `21m ago · opened a folder in Files`. */
export function actionsNoteLines(
  data: SessionMessageDataPart.ActionsDataPart,
): string[] {
  return data.rows.map(
    (row) =>
      `${row.minutes < 1 ? "now" : `${row.minutes}m ago`} · ${actionPhrase(row)}`,
  );
}

/**
 * Tells the model what kinds of things the user did in the app before the
 * message, and where the names are: a note that named them pulled the agent
 * toward what the user had opened over what their words named.
 */
export function actionsModelNote(data: SessionMessageDataPart.ActionsDataPart) {
  const rows = actionsNoteLines(data)
    .map((line) => `- ${line}`)
    .join("\n");
  return systemNote`
    Background, not something they sent: what the user did in this app before this message, oldest first, without names. \`${ACTIVITY_COMMAND.name}\` gives the names and paths, for when their words point at one of these.
    ${rows}
  `;
}
