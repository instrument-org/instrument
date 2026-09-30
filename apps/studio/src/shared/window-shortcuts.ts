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
