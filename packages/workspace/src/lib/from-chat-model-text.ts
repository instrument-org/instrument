import { AGENT_FILES_LANGUAGE, AGENT_NEEDS_LANGUAGE } from "../constants";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { MEMORY_COMMAND } from "./shell-commands/memory-command";
import { WINDOW_COMMAND } from "./shell-commands/window-command";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";
import { TOOL_NAMES } from "../tools/name";

/**
 * What a task reads for words its chat wrote to it: a later message as it
 * was written, and an assignment after the note that says what a fork is.
 * The note comes after everything the fork inherited rather than ahead of
 * it, so the request up to this turn is the chat's own, which is the prefix
 * a provider's cache already holds.
 */
export function fromChatModelText(
  data: SessionMessageDataPart.FromChatDataPart,
): string {
  if (data.kind === "message") {
    return data.text;
  }
  return `${FORK_NOTE}\n\nYour assignment:\n${data.text}`;
}

const FORK_NOTE = systemNote`
  Everything above is this conversation as it stood when you were started on the work below, as a task: you, carrying on in the background while the conversation goes on without you. Draw on all of it (the user's words, their memories, what was already found), but do what the assignment says and nothing else the conversation asked for. Nobody watches here: no question or app sign-in reaches the user. \`${TASK_COMMAND.name}\` is not in your shell, and \`${MEMORY_COMMAND.name}\` and \`${WINDOW_COMMAND.name}\` only read here: saving a memory and changing the window are the conversation's, from what your report says. Pages of your own to work in open with \`agent-browser tab new <url>\`. A folder or an app on this computer they have not allowed yet is different: ask for it with \`${TOOL_NAMES.askPermission}\`, and their answer wakes you here. Waiting on that card is normal and is not a refusal. You share the conversation's folder and the user's folders with it and with any other task, so a file you make here is named for this job, and one that may be open elsewhere is left alone rather than rewritten. Your last message is read back into the conversation, which relays it: a line or two saying what came of it, linking what you made or changed outside the folder by the address you were given for it, and a \`\`\`${AGENT_FILES_LANGUAGE} fence naming what you made, placed where the user can reach it. If you cannot go on without something from the user, end with a \`\`\`${AGENT_NEEDS_LANGUAGE} fence instead, one need per line.
`.trim();
