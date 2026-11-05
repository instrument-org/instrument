import { APP_NAME } from "@instrument-org/shared";

import { FOLDER_VARIABLES } from "../../constants";
import { shellPath as shellSpelling } from "../shell-path";
import { type Action, type ActionInput } from "./schema";

/**
 * One action as a plain sentence about the person, without its subject or
 * its time: "moved a.pdf, b.pdf from /Users/sam/Downloads into
 * /Users/sam/Documents". Every path is written out in full as the agent's
 * shell spells it, and another chat is named by its records folder, so the
 * agent can open what a sentence names.
 */
export function actionSentence(
  action: Action | ActionInput,
  shellPath: (hostPath: string) => string = shellSpelling,
): string {
  switch (action.kind) {
    case "folder": {
      const selected = action.selected?.length
        ? `, with ${action.selected.join(", ")} selected`
        : "";
      return `opened the folder ${shellPath(action.path)} in Files${selected}`;
    }
    case "file": {
      return `opened ${shellPath(action.path)}`;
    }
    case "open-with": {
      return `opened ${shellPath(action.path)} in ${action.app ?? "another app"}`;
    }
    case "edit": {
      return `edited and saved ${shellPath(action.path)}`;
    }
    case "move":
    case "copy": {
      return `${action.kind === "move" ? "moved" : "copied"} ${action.names.join(", ")} from ${shellPath(action.from)} into ${shellPath(action.to)}`;
    }
    case "rename": {
      return `renamed ${shellPath(action.from)} to ${shellPath(action.to)}`;
    }
    case "trash": {
      return `moved ${action.paths.map((each) => shellPath(each)).join(", ")} to the Trash`;
    }
    case "new-folder": {
      return `made the folder ${shellPath(action.path)}`;
    }
    case "chat": {
      return `opened the chat "${action.title}", its records in $${FOLDER_VARIABLES.chats}/${action.id}`;
    }
    case "page": {
      return action.title
        ? `visited "${action.title}" at ${action.url}`
        : `visited ${action.url}`;
    }
    case "download": {
      return `downloaded ${shellPath(action.path)}${action.url ? ` from ${action.url}` : ""}`;
    }
    case "app": {
      return action.did === "signed in"
        ? `signed in to the app "${action.name}"`
        : action.did === "disconnected"
          ? `disconnected the app "${action.name}"`
          : `couldn't sign in to the app "${action.name}"`;
    }
    case "update": {
      return `updated ${APP_NAME} from ${action.from} to ${action.to}`;
    }
    case "permission": {
      const what =
        action.path === undefined ? (action.app ?? "") : shellPath(action.path);
      return action.did === "allowed"
        ? `allowed the chat "${action.title}" to use ${what}`
        : `refused the chat "${action.title}" ${what}`;
    }
    case "error": {
      return `saw the error "${action.message}"${action.where ? ` (${action.where})` : ""}`;
    }
    case "screen": {
      return `opened ${action.name}`;
    }
    case "setting": {
      return `changed the setting "${action.name}" to "${action.value}"`;
    }
    case "capped": {
      return action.of === "day"
        ? "(the log stopped here for the rest of the day, past its daily limit)"
        : `(${action.dropped} more ${action.of} actions were left out here, past the log's limit)`;
    }
  }
}
