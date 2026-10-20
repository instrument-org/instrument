import { type ShortcutAccelerator } from "@/shared/shortcuts";

/**
 * The app window's chords, one table for the menu that draws them, the key
 * binder that answers them, and the tooltips that show them: a chord written
 * in one place cannot disagree with itself in another. A chord here is
 * answered by the window's renderer over the command stream; the app menu's
 * and the Developer menu's own chords, which the main process answers, are
 * `shortcuts.ts`.
 */
export interface WindowShortcut {
  accelerator: ShortcutAccelerator;
  label: string;
}

/**
 * The rail's places, one chord each in the rail's order: Control and Command
 * with the digit on a Mac, as Safari puts its sidebar's sections, where
 * Option and a digit types a character; Alt and the digit elsewhere, where
 * Control and Alt together is AltGr on many layouts and types one too. One
 * modifier away from the tabs' Cmd or Ctrl and a digit.
 */
const placeChord = (digit: number) => ({
  darwin: `Control+Command+${digit}`,
  default: `Alt+${digit}`,
});

/**
 * Down and up the inbox: Option and Command with the arrow on a Mac, where
 * Option and an arrow alone moves the caret. Elsewhere Alt+Shift and the
 * arrow, which chat apps there step through unread conversations with: GNOME
 * takes Ctrl+Alt and an arrow to switch workspaces, and Alt and ↑ is the
 * parent folder in Files, as in File Explorer.
 */
const chatChord = (arrow: "Down" | "Up") => ({
  darwin: `Alt+CmdOrCtrl+${arrow}`,
  default: `Alt+Shift+${arrow}`,
});

/**
 * Back and forward: Command and a bracket on a Mac, as Safari has them; Alt
 * and an arrow elsewhere, as every browser and File Explorer have them there.
 */
const historyChord = (bracket: "[" | "]", arrow: "Left" | "Right") => ({
  darwin: `CmdOrCtrl+${bracket}`,
  default: `Alt+${arrow}`,
});

export const WINDOW_SHORTCUTS = {
  back: { accelerator: historyChord("[", "Left"), label: "Back" },
  closeTab: { accelerator: "CmdOrCtrl+W", label: "Close Tab" },
  commandMenu: { accelerator: "CmdOrCtrl+K", label: "Command Menu" },
  editPage: { accelerator: "CmdOrCtrl+E", label: "Edit Page" },
  findInPage: { accelerator: "CmdOrCtrl+F", label: "Find in Page" },
  findNext: { accelerator: "CmdOrCtrl+G", label: "Find Next" },
  findPrevious: { accelerator: "Shift+CmdOrCtrl+G", label: "Find Previous" },
  forward: { accelerator: historyChord("]", "Right"), label: "Forward" },
  goToApps: { accelerator: placeChord(4), label: "Go to Apps" },
  goToBrowser: { accelerator: placeChord(3), label: "Go to Browser" },
  goToChat: { accelerator: placeChord(1), label: "Go to Chat" },
  goToFiles: { accelerator: placeChord(2), label: "Go to Files" },
  newChat: { accelerator: "CmdOrCtrl+N", label: "New Chat" },
  newTab: { accelerator: "CmdOrCtrl+T", label: "New Tab" },
  nextChat: { accelerator: chatChord("Down"), label: "Next Chat" },
  nextTab: { accelerator: "Ctrl+Tab", label: "Show Next Tab" },
  previousChat: { accelerator: chatChord("Up"), label: "Previous Chat" },
  previousTab: { accelerator: "Ctrl+Shift+Tab", label: "Show Previous Tab" },
  reloadPage: { accelerator: "CmdOrCtrl+R", label: "Reload Page" },
  reopenTab: { accelerator: "Shift+CmdOrCtrl+T", label: "Reopen Closed Tab" },
  search: { accelerator: "CmdOrCtrl+L", label: "Search or Ask" },
  toggleInbox: { accelerator: "CmdOrCtrl+B", label: "Toggle Inbox" },
} as const satisfies Record<string, WindowShortcut>;

export type WindowShortcutId = keyof typeof WINDOW_SHORTCUTS;

/**
 * The window's chords that are a code editor's own keys too, on every
 * system: Back and Forward are its indent and outdent on a Mac and its step
 * over a syntax node elsewhere, and Next and Previous Chat add a cursor above
 * or below on a Mac and copy the line elsewhere, and Find Next and Previous
 * step its own search. While a code editor holds
 * the keyboard these reach it first, and the menu answers only a press it
 * leaves alone. Find is its too, and the window already hands that to the
 * editor's own search.
 */
export const CODE_EDITOR_SHORTCUTS: ReadonlySet<WindowShortcutId> = new Set([
  "back",
  "findNext",
  "findPrevious",
  "forward",
  "nextChat",
  "previousChat",
]);

/**
 * Second chords for a few of the window's commands, answered and left out of
 * the menu and the guide: each system's other way to the same thing, the
 * Mac's Safari tab chords, and the Ctrl+PageDown, F5 and Ctrl+F4 that
 * browsers on Windows and Linux have. A side a chord is missing from has
 * none.
 */
export const WINDOW_SHORTCUT_ALIASES: {
  accelerator: { darwin?: string; default?: string };
  id: WindowShortcutId;
}[] = [
  {
    accelerator: { darwin: "CmdOrCtrl+Shift+]", default: "Ctrl+PageDown" },
    id: "nextTab",
  },
  {
    accelerator: { darwin: "CmdOrCtrl+Shift+[", default: "Ctrl+PageUp" },
    id: "previousTab",
  },
  { accelerator: { default: "F5" }, id: "reloadPage" },
  { accelerator: { default: "F3" }, id: "findNext" },
  { accelerator: { default: "Shift+F3" }, id: "findPrevious" },
  { accelerator: { default: "Ctrl+F4" }, id: "closeTab" },
];

/**
 * The window's chords that its menu answers without the renderer: a tab by
 * its place, closing the window, quitting, zoom, and full screen. The menus
 * read their keys from here, and the shortcut guide lists them.
 */
export const WINDOW_MENU_SHORTCUTS = {
  actualSize: { accelerator: "CmdOrCtrl+0", label: "Actual Size" },
  closeWindow: { accelerator: "Shift+CmdOrCtrl+W", label: "Close Window" },
  lastTab: { accelerator: "CmdOrCtrl+9", label: "Last Tab" },
  // Ctrl+Q off the Mac, Windows included, whose quit role Electron gives no
  // chord. Alt+F4 quits there too, by closing the last window.
  quit: { accelerator: "CmdOrCtrl+Q", label: "Quit" },
  // Stands for eight chords, one per tab, which the menu spells out itself;
  // written the way the guide reads it.
  tabByPlace: { accelerator: "CmdOrCtrl+1…8", label: "Tab 1 to 8" },
  toggleFullScreen: {
    accelerator: { darwin: "Control+Command+F", default: "F11" },
    label: "Toggle Full Screen",
  },
  // Ctrl+= off the Mac, the key pressed there, where the plus sign takes
  // Shift; the Mac writes the chord as ⌘+.
  zoomIn: {
    accelerator: { darwin: "CmdOrCtrl+Plus", default: "CmdOrCtrl+=" },
    label: "Zoom In",
  },
  zoomOut: { accelerator: "CmdOrCtrl+-", label: "Zoom Out" },
} as const satisfies Record<
  string,
  { accelerator: ShortcutAccelerator; label: string }
>;

export type WindowMenuShortcutId = keyof typeof WINDOW_MENU_SHORTCUTS;
