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
  description: `What the user sees: the tabs in their window, pages, files, folders and screens alike, each by its tab_ id, which is for commands: in replies, name a tab by its title. Any tab id works, in any tab group. \`instrument window list [group]\` names a group's tabs, by default the group you work in, which tab each side shows and which are hidden, and which task is working in each; \`instrument window read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are. Changing the window is the chat's: \`instrument window show <url or path>...\` opens each in a tab of its own, never in place of you, printing the tab's id, which \`agent-browser tab\` takes, and where it landed: which side, whether it shows or is hidden behind another tab, and whether it covers you; \`instrument window show <id>\` makes a tab the one its side shows; \`instrument window show <url or path> --in <id>\` shows something else in a tab; \`instrument window close <id>...\` closes tabs; \`instrument window wait <id> --title '<what to do, a few words>' --reason '<why, one short sentence>'\` hands them a page you opened for what only they can do there (sign in, prove they are a person): its side shows it, a card shows your title and reason with Done and Skip, your turn ends, and their answer wakes you. A path is a file or folder you can read. It opens nothing in the user's own applications and downloads nothing.`,
  name: `${INSTRUMENT_COMMAND.name} window`,
  summary:
    "What the user sees: list, show, read and close the tabs in their tab group, or ask for one of theirs.",
  word: "window",
} as const;

/**
 * Why a task's `instrument window` changes nothing: the window is what the
 * person sees, and only the chat they talk to arranges it.
 */
export const WAITING_IS_THE_CHATS =
  "only the chat hands the user a page. End your last message with a needs fence naming the tab and what the user has to do there (sign in, prove they are a person); the chat asks them and sends you on.";

export const WINDOW_IS_THE_CHATS =
  "only the chat changes the window. To open a page to work in, use `agent-browser tab new <url>`; say in your report what the chat should show.";
