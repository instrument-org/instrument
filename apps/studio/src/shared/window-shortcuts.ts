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
  accelerator: string;
  label: string;
}

export const WINDOW_SHORTCUTS = {
  back: { accelerator: "CmdOrCtrl+[", label: "Back" },
  closeTab: { accelerator: "CmdOrCtrl+W", label: "Close Tab" },
  editPage: { accelerator: "CmdOrCtrl+E", label: "Edit Page" },
  findInPage: { accelerator: "CmdOrCtrl+F", label: "Find in Page" },
  forward: { accelerator: "CmdOrCtrl+]", label: "Forward" },
  newChat: { accelerator: "CmdOrCtrl+N", label: "New Chat" },
  newTab: { accelerator: "CmdOrCtrl+T", label: "New Tab" },
  nextChat: { accelerator: "Alt+CmdOrCtrl+Down", label: "Next Chat" },
  nextTab: { accelerator: "Ctrl+Tab", label: "Show Next Tab" },
  previousChat: { accelerator: "Alt+CmdOrCtrl+Up", label: "Previous Chat" },
  previousTab: { accelerator: "Ctrl+Shift+Tab", label: "Show Previous Tab" },
  reloadPage: { accelerator: "CmdOrCtrl+R", label: "Reload Page" },
  reopenTab: { accelerator: "Shift+CmdOrCtrl+T", label: "Reopen Closed Tab" },
  search: { accelerator: "CmdOrCtrl+L", label: "Search or Ask" },
  toggleInbox: { accelerator: "CmdOrCtrl+B", label: "Toggle Inbox" },
} as const satisfies Record<string, WindowShortcut>;

export type WindowShortcutId = keyof typeof WINDOW_SHORTCUTS;

/**
 * The window's chords that its menu answers without the renderer: a tab by
 * its place, closing the window, zoom, and full screen. The menus read their
 * keys from here, and the shortcut guide lists them.
 */
export const WINDOW_MENU_SHORTCUTS = {
  actualSize: { accelerator: "CmdOrCtrl+0", label: "Actual Size" },
  closeWindow: { accelerator: "Shift+CmdOrCtrl+W", label: "Close Window" },
  lastTab: { accelerator: "CmdOrCtrl+9", label: "Last Tab" },
  // Stands for eight chords, one per tab, which the menu spells out itself;
  // written the way the guide reads it.
  tabByPlace: { accelerator: "CmdOrCtrl+1…8", label: "Tab 1 to 8" },
  toggleFullScreen: {
    accelerator: { darwin: "Control+Command+F", default: "F11" },
    label: "Toggle Full Screen",
  },
  zoomIn: { accelerator: "CmdOrCtrl+Plus", label: "Zoom In" },
  zoomOut: { accelerator: "CmdOrCtrl+-", label: "Zoom Out" },
} as const satisfies Record<
  string,
  { accelerator: ShortcutAccelerator; label: string }
>;

export type WindowMenuShortcutId = keyof typeof WINDOW_MENU_SHORTCUTS;
