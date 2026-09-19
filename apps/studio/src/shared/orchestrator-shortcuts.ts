/**
 * The 2.0 window's chords, one table for the menu that draws them, the key
 * binder that answers them, and the tooltips that show them: a chord written
 * in one place cannot disagree with itself in another. The classic window's
 * table is `shortcuts.ts`; this window has its own because its furniture is
 * its own (threads, the inbox column, a pane of tabs per thread), and a
 * chord here is answered by the window's renderer over the command stream
 * rather than by the main process.
 */
export interface OrchestratorShortcut {
  accelerator: string;
  label: string;
}

export const ORCHESTRATOR_SHORTCUTS = {
  back: { accelerator: "CmdOrCtrl+[", label: "Back" },
  closeTab: { accelerator: "CmdOrCtrl+W", label: "Close Tab" },
  findInPage: { accelerator: "CmdOrCtrl+F", label: "Find in Page" },
  forward: { accelerator: "CmdOrCtrl+]", label: "Forward" },
  newTab: { accelerator: "CmdOrCtrl+T", label: "New Tab" },
  newThread: { accelerator: "CmdOrCtrl+N", label: "New Thread" },
  nextTab: { accelerator: "Ctrl+Tab", label: "Show Next Tab" },
  nextThread: { accelerator: "Alt+CmdOrCtrl+Down", label: "Next Thread" },
  previousTab: { accelerator: "Ctrl+Shift+Tab", label: "Show Previous Tab" },
  previousThread: { accelerator: "Alt+CmdOrCtrl+Up", label: "Previous Thread" },
  reopenTab: { accelerator: "Shift+CmdOrCtrl+T", label: "Reopen Closed Tab" },
  search: { accelerator: "CmdOrCtrl+L", label: "Search or Ask" },
  toggleInbox: { accelerator: "CmdOrCtrl+B", label: "Toggle Inbox" },
} as const satisfies Record<string, OrchestratorShortcut>;

export type OrchestratorShortcutId = keyof typeof ORCHESTRATOR_SHORTCUTS;
