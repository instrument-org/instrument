import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and description of the `instrument window` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 *
 * The description is the same in a chat's shell and a task's, since a tool
 * definition is part of the prefix a provider caches; it says which forms are
 * the chat's.
 */
export const WINDOW_COMMAND = {
  description: `What is in front of the user: this chat's tabs in their window, pages, files, folders and screens alike, each by its tab_ id. \`instrument window list\` names them, which one is in front, and which task is working in each; \`instrument window read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are. Changing the window is the chat's: \`instrument window show <url or path>...\` opens each in a tab of its own in front, printing the tab's id, which a task takes with --tab; \`instrument window show <id>\` brings an open tab forward; \`instrument window show <url or path> --in <id>\` shows something else in a tab; \`instrument window close <id>...\` closes tabs; \`instrument window request <id> --reason '<one sentence to the user>'\` asks the user to move a tab of their own, which the note on their message named outside this chat, into it: a card shows them your reason with Move tab here and Skip, your turn ends, and their answer wakes you. A path is a file or folder you can read. It opens nothing in the user's own applications and downloads nothing.`,
  name: `${INSTRUMENT_COMMAND.name} window`,
  summary:
    "What is in front of the user: list, show, read and close this chat's tabs, or ask for one of theirs.",
  word: "window",
} as const;

/**
 * The word `instrument window` went by before, kept as an alias: stored
 * conversations hold calls in the old form, and a model imitates its history.
 */
export const TAB_ALIAS_WORD = "tab";

/**
 * Why a task's `instrument window` changes nothing: the window is in front of
 * the person, and only the chat they talk to arranges it.
 */
export const WINDOW_IS_THE_CHATS =
  "only the chat changes the window. To open a page to work in, use `agent-browser tab new <url>`; say in your report what the chat should show.";
