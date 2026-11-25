import { INSTRUMENT_COMMAND } from "./instrument-command";
import {
  MOVE_TO_NEW_TAB_GROUP,
  RECENTLY_CLOSED,
  WAIT_CARD_WORDS,
} from "../../lib/screen-words";

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
  description: `What the user sees: the tabs in their windows, pages, files, folders and screens alike, each by its tab_ id, and the tab groups that hold them, each by its group: id; ids are for commands, and a reply names a tab by its title and links a tab or group by the \`instrument://tab/<id>\` or \`instrument://group/<id>\` address \`list\` prints. Any tab id works here, in any tab group; \`agent-browser\` drives only the tabs of the group you work in, so to act in another tab, move it there first. \`instrument window list [group]\` lists a group (by its id or its name; by default the group you work in): whether it is pinned, its project, whether it is on screen and when it was last brought up, each tab with where it stands (the side showing it, or hidden), what it shows and its address, which task is working in each, whether its chat is working, waiting on the user or unread and its latest line, whether a page uses the microphone or camera or can't connect, what the user sees, and the other groups there are; \`list --all\` lists every window's groups and their tabs. \`instrument window read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are. \`instrument window look\` shows you a picture of the window as they see it, for what only seeing it answers (how something looks, where a control is, what they mean by "this button"); it is the chat's, only while answering a message they just sent, and what you can't read is gray. Changing the window is the chat's: \`instrument window show <url, path or app address>...\` opens each in a tab of its own, never in place of you, printing the tab's id, which \`agent-browser tab\` takes, and where it landed: which side, whether it shows or is hidden behind another tab, and whether it covers you; \`--group <group>\` opens it in that group instead, the window staying where it is; \`instrument window show <tab id>\` makes a tab the one its side shows, switching the window to its group when that group is not on screen; \`instrument window show <group id>\` switches the window to a group, its window in front; \`instrument window show <url, path or app address> --in <id>\` shows something else in a tab; \`instrument window close <id>...\` closes tabs, or a whole group by its id; the user can bring back from ${RECENTLY_CLOSED} what was theirs or a pinned group, not an agent's tab they never used, and chats in it go on working; \`instrument window wait <id> --title '<what to do, a few words>' --reason '<why, one short sentence>'\` hands them a page you opened for what only they can do there (sign in, prove they are a person): its side shows it, a card shows your title and reason with ${WAIT_CARD_WORDS.done} and ${WAIT_CARD_WORDS.skip}, your turn ends, and their answer wakes you. \`instrument window group <tab id>...\` makes a new tab group of tabs, and \`instrument window move <tab id>... --group <group>\` moves tabs into one, each as the user's own ${MOVE_TO_NEW_TAB_GROUP} or drag does; \`move\` with \`--side left\` or \`--side right\` puts tabs on a side, beside the rest of their group, and with \`--before <tab id>\` or \`--after <tab id>\` beside a tab in its strip; \`instrument window join [group]\` makes a split group's sides one. \`instrument window new <tab id>...\` (or \`<group>\`) puts them in a new window, only when the message you are answering asks for a new window: nothing else is a reason to open one, and it is refused in a turn the user did not start. \`instrument window pin <group>...\` and \`unpin <group>...\` change a group's pin, and \`instrument window place <group> --before <group>\` (or \`--after\`) moves it in the sidebar. \`instrument window history [--closed] [--limit N]\` lists the window's History, newest first, what was closed by the id \`instrument window restore <id>\` takes to reopen it as History does. A path is a file or folder you can read; an app address is the \`instrument://\` address \`list\` prints for a chat, an app, a task or a built-in page, the one replies link it by. It opens nothing in the user's own applications and downloads nothing.`,
  name: `${INSTRUMENT_COMMAND.name} window`,
  summary:
    "What the user sees: list, show, read and close the tabs and tab groups in their windows, or ask for one of theirs.",
  word: "window",
} as const;

/**
 * Why a task's `instrument window` changes nothing: the window is what the
 * person sees, and only the chat they talk to arranges it.
 */
export const WAITING_IS_THE_CHATS =
  "only the chat hands the user a page. End your last message with a needs fence naming the tab and what the user has to do there (sign in, prove they are a person); the chat asks them and sends you on.";

export const LOOKING_IS_THE_CHATS =
  "only the chat looks at the user's window, while it answers them. Say in your report what you would need to know about it.";

export const WINDOW_IS_THE_CHATS =
  "only the chat changes the window. To open a page to work in, use `agent-browser tab new <url>`; say in your report what the chat should show.";

/** Why a turn the person did not start opens no window, whatever it was asked before. */
export const NEW_WINDOW_IS_THE_USERS =
  "a new window opens only in a turn the user started, when their message asks for one, and something else has woken you since theirs. Leave the window as it is.";
