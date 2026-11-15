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
 * Down and up the sidebar's tab groups: Option and Command with the arrow on
 * a Mac, where Option and an arrow alone moves the caret. Elsewhere Alt+Shift and the
 * arrow, which chat apps there step through unread conversations with: GNOME
 * takes Ctrl+Alt and an arrow to switch workspaces, and Alt and ↑ is the
 * parent folder in Files, as in File Explorer.
 */
const chatChord = (arrow: "Down" | "Up") => ({
  darwin: `Alt+CmdOrCtrl+${arrow}`,
  default: `Alt+Shift+${arrow}`,
});

/**
 * The keyboard to the left or right side of a tab group: Option and Command
 * with the arrow on a Mac, as a terminal steps between its split panes, the
 * group chords' arrows turned sideways; Alt+Shift and the arrow elsewhere,
 * beside them.
 */
const sideChord = (arrow: "Left" | "Right") => ({
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
  // A browser's own key for the star at the end of its address field.
  bookmarkTab: { accelerator: "CmdOrCtrl+D", label: "Bookmark This Tab…" },
  closeTab: { accelerator: "CmdOrCtrl+W", label: "Close Tab" },
  // The system's file manager's own key: Get Info's on a Mac, and Properties'
  // in File Explorer, GNOME's Files and Dolphin.
  fileInfo: {
    accelerator: { darwin: "CmdOrCtrl+I", default: "Alt+Enter" },
    label: "Info",
  },
  commandMenu: { accelerator: "CmdOrCtrl+K", label: "Command Menu" },
  editPage: { accelerator: "CmdOrCtrl+E", label: "Edit Page" },
  // The search of the surface the keyboard is in: a chat, a file, a page.
  findInPage: { accelerator: "CmdOrCtrl+F", label: "Find" },
  findNext: { accelerator: "CmdOrCtrl+G", label: "Find Next" },
  findPrevious: { accelerator: "Shift+CmdOrCtrl+G", label: "Find Previous" },
  // The keyboard to a side of the tab group on screen, which a press on it
  // gives too.
  focusLeftSide: { accelerator: sideChord("Left"), label: "Focus Left Side" },
  focusRightSide: {
    accelerator: sideChord("Right"),
    label: "Focus Right Side",
  },
  forward: { accelerator: historyChord("]", "Right"), label: "Forward" },
  newChat: { accelerator: "CmdOrCtrl+N", label: "New Tab Group" },
  newTab: { accelerator: "CmdOrCtrl+T", label: "New Tab" },
  // A new tab on the other side of the group on screen, made where it has
  // one side: Chrome's split chord, Option and Command and N on a Mac, and
  // Alt+Shift+N elsewhere, beside the side chords.
  newTabInSplit: {
    accelerator: { darwin: "Alt+CmdOrCtrl+N", default: "Alt+Shift+N" },
    label: "New Tab in Split",
  },
  nextChat: { accelerator: chatChord("Down"), label: "Next Tab Group" },
  nextTab: { accelerator: "Ctrl+Tab", label: "Show Next Tab" },
  previousChat: { accelerator: chatChord("Up"), label: "Previous Tab Group" },
  previousTab: { accelerator: "Ctrl+Shift+Tab", label: "Show Previous Tab" },
  printPage: { accelerator: "CmdOrCtrl+P", label: "Print…" },
  reloadPage: { accelerator: "CmdOrCtrl+R", label: "Reload Page" },
  reopenTab: { accelerator: "Shift+CmdOrCtrl+T", label: "Reopen Closed Tab" },
  search: { accelerator: "CmdOrCtrl+L", label: "Open Location…" },
  // Find with Shift, as a code editor searches every file: the Chats page's
  // search, over every chat, where Find is the one chat on screen.
  searchChats: {
    accelerator: "Shift+CmdOrCtrl+F",
    label: "Search Chats",
  },
  // Show All History's key: ⌘Y in Safari and Chrome on a Mac, and Ctrl+H in
  // browsers elsewhere.
  showActivity: {
    accelerator: { darwin: "CmdOrCtrl+Y", default: "Ctrl+H" },
    label: "Show History",
  },
  // A browser's own key for its bookmarks bar.
  toggleBookmarksBar: {
    accelerator: "Shift+CmdOrCtrl+B",
    label: "Show Bookmarks Bar",
  },
  toggleSidebar: { accelerator: "CmdOrCtrl+B", label: "Toggle Sidebar" },
} as const satisfies Record<string, WindowShortcut>;

export type WindowShortcutId = keyof typeof WINDOW_SHORTCUTS;

/**
 * The window's chords that are a code editor's own keys too, on every
 * system: Back and Forward are its indent and outdent on a Mac and its step
 * over a syntax node elsewhere, and Next and Previous Chat add a cursor above
 * or below on a Mac and copy the line elsewhere, Focus Left and Right Side
 * select over a syntax node off the Mac, Find Next and Previous
 * step its own search, and Bookmark This Tab selects the next match. While a
 * code editor holds
 * the keyboard these reach it first, and the menu answers only a press it
 * leaves alone. Find is its too, and the window already hands that to the
 * editor's own search.
 */
export const CODE_EDITOR_SHORTCUTS: ReadonlySet<WindowShortcutId> = new Set([
  "back",
  "bookmarkTab",
  "findNext",
  "findPrevious",
  "focusLeftSide",
  "focusRightSide",
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
  // Cmd+N is a new tab group, so a window takes Shift, as it does in a
  // code editor and in Notion.
  newWindow: { accelerator: "Shift+CmdOrCtrl+N", label: "New Window" },
  // No chord on Windows, as Electron's quit role leaves it: Alt+F4 is how an
  // app closes there, and Ctrl+Q sits beside Ctrl+W and Tab.
  quit: { accelerator: "CmdOrCtrl+Q", label: "Quit", noChordOnWindows: true },
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
  { accelerator: ShortcutAccelerator; label: string; noChordOnWindows?: true }
>;

export type WindowMenuShortcutId = keyof typeof WINDOW_MENU_SHORTCUTS;
