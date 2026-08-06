/**
 * Every keyboard shortcut the app declares, as data. One entry feeds the native
 * menu (which projects it into a menu item), the accelerator binder in the main
 * process, and the in-app shortcut guide, so adding a chord is one edit and no
 * surface can drift from another.
 *
 * Descriptors are serializable on purpose: the renderer needs `label`,
 * `accelerator` and `group` to draw the guide, and none of that can travel with
 * a `run` closing over main-process state. Actions live beside the process that
 * can perform them (`electron-main/menus/shortcuts.ts`).
 */

/** Electron-shaped accelerator, or one per platform where the chords differ. */
export type ShortcutAccelerator = string | { darwin: string; default: string };

export interface ShortcutDescriptor {
  /** The chord the menu and the guide show. */
  accelerator: ShortcutAccelerator;
  /**
   * Further chords that run the same action and are shown nowhere: the other
   * physical keys that mean a chord (the numpad's own `+`, `Ctrl+=` where
   * `Ctrl+Plus` is meant), and the per-key chords behind a range like
   * `CmdOrCtrl+1…8`. They exist so a key works, not so a user learns four ways
   * to zoom in, which is why the guide lists one row and the menu one item.
   */
  alternates?: string[];
  /** Section the guide lists this under. Menu placement is the menu's own business. */
  group: ShortcutGroup;
  label: string;
  /**
   * Who binds the chord:
   *
   * - `menu` -- the app owns it outright. The main process runs it from the raw
   *   key event ahead of the focused page, and projects it into a native menu
   *   item carrying the same accelerator.
   * - `renderer` -- a renderer keydown, for a chord that is layout-dependent or
   *   has to yield to a focused editor. The menu can still offer the item, just
   *   without an accelerator. Never taken in main.
   * - `external` -- the app owns the chord but the menu shows no row for it,
   *   either because it stands for a range of keys or because an Electron role
   *   performs it. Still listed, so the guide can show it.
   *
   * Chords an editor legitimately uses (Mod-Z to undo) are not the app's to
   * take: they stay Electron roles on the Edit menu and out of this table.
   */
  owner: "external" | "menu" | "renderer";
}

export type ShortcutGroup =
  | "Developer"
  | "General"
  | "Navigation"
  | "Tabs"
  | "View";

export type ShortcutId = keyof typeof SHORTCUTS;

/** The order the guide draws its sections in. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "General",
  "Tabs",
  "Navigation",
  "View",
  "Developer",
];

export const SHORTCUTS = {
  closeTab: {
    accelerator: "CmdOrCtrl+W",
    group: "Tabs",
    label: "Close Tab",
    owner: "menu",
  },
  commandMenu: {
    accelerator: "CmdOrCtrl+K",
    group: "General",
    label: "Show Command Menu",
    owner: "menu",
  },
  findInPage: {
    accelerator: "CmdOrCtrl+F",
    group: "Navigation",
    label: "Find…",
    owner: "menu",
  },
  goBack: {
    accelerator: "CmdOrCtrl+[",
    group: "Navigation",
    label: "Back",
    owner: "menu",
  },
  goForward: {
    accelerator: "CmdOrCtrl+]",
    group: "Navigation",
    label: "Forward",
    owner: "menu",
  },
  newTab: {
    accelerator: "CmdOrCtrl+T",
    group: "Tabs",
    label: "New Tab",
    owner: "menu",
  },
  newTask: {
    accelerator: "CmdOrCtrl+N",
    group: "General",
    label: "New Task",
    owner: "menu",
  },
  reloadPage: {
    accelerator: "CmdOrCtrl+R",
    group: "Navigation",
    label: "Reload Page",
    owner: "menu",
  },
  reloadWebViews: {
    accelerator: "CmdOrCtrl+Shift+R",
    group: "Developer",
    label: "Reload All Web Views",
    owner: "menu",
  },
  reopenTab: {
    accelerator: "CmdOrCtrl+Shift+T",
    group: "Tabs",
    label: "Reopen Closed Tab",
    owner: "menu",
  },
  resetZoom: {
    accelerator: "CmdOrCtrl+0",
    group: "View",
    label: "Actual Size",
    owner: "menu",
  },
  selectLastTab: {
    accelerator: "CmdOrCtrl+9",
    group: "Tabs",
    label: "Switch to Last Tab",
    owner: "external",
  },
  selectNextTab: {
    accelerator: "Ctrl+Tab",
    alternates: ["CmdOrCtrl+Shift+]"],
    group: "Tabs",
    label: "Show Next Tab",
    owner: "menu",
  },
  selectPreviousTab: {
    accelerator: "Ctrl+Shift+Tab",
    alternates: ["CmdOrCtrl+Shift+["],
    group: "Tabs",
    label: "Show Previous Tab",
    owner: "menu",
  },
  // The chord stands for eight of them, so it is written the way the guide
  // reads it and the real keys are the alternates.
  selectTabByIndex: {
    accelerator: "CmdOrCtrl+1…8",
    alternates: [
      "CmdOrCtrl+1",
      "CmdOrCtrl+2",
      "CmdOrCtrl+3",
      "CmdOrCtrl+4",
      "CmdOrCtrl+5",
      "CmdOrCtrl+6",
      "CmdOrCtrl+7",
      "CmdOrCtrl+8",
    ],
    group: "Tabs",
    label: "Switch to Tab",
    owner: "external",
  },
  settings: {
    accelerator: "CmdOrCtrl+,",
    group: "General",
    label: "Settings...",
    owner: "menu",
  },
  shortcutGuide: {
    accelerator: "?",
    group: "General",
    label: "Keyboard Shortcuts",
    owner: "renderer",
  },
  themeDark: {
    accelerator: "CmdOrCtrl+Shift+D",
    group: "Developer",
    label: "Set Theme: Dark",
    owner: "menu",
  },
  themeLight: {
    accelerator: "CmdOrCtrl+Shift+L",
    group: "Developer",
    label: "Set Theme: Light",
    owner: "menu",
  },
  themeSystem: {
    accelerator: "CmdOrCtrl+Shift+M",
    group: "Developer",
    label: "Set Theme: System",
    owner: "menu",
  },
  toggleFullscreen: {
    accelerator: { darwin: "Control+Command+F", default: "F11" },
    group: "View",
    label: "Toggle Full Screen",
    owner: "external",
  },
  toggleSidebar: {
    accelerator: "CmdOrCtrl+B",
    group: "View",
    label: "Toggle Sidebar",
    owner: "menu",
  },
  zoomIn: {
    accelerator: "CmdOrCtrl+Plus",
    // `Ctrl+=` is what a Windows keyboard physically offers for zoom in, and the
    // numpad's `+` is a key of its own rather than a shifted `=`.
    alternates: ["CmdOrCtrl+=", "CmdOrCtrl+numadd"],
    group: "View",
    label: "Zoom In",
    owner: "menu",
  },
  zoomOut: {
    accelerator: "CmdOrCtrl+-",
    alternates: ["CmdOrCtrl+numsub"],
    group: "View",
    label: "Zoom Out",
    owner: "menu",
  },
} satisfies Record<string, ShortcutDescriptor>;

/**
 * The table as a list, for the consumers that walk every entry rather than
 * naming one. Key order is lint-sorted and carries no meaning -- the guide
 * orders rows itself.
 */
export const SHORTCUT_ENTRIES: {
  descriptor: ShortcutDescriptor;
  id: ShortcutId;
}[] = Object.entries(SHORTCUTS).map(([id, descriptor]) => ({
  descriptor,
  // `Object.entries` widens the keys to `string`; they are this table's ids.
  id: id as ShortcutId,
}));

export function resolveAccelerator(
  accelerator: ShortcutAccelerator,
  { isMac }: { isMac: boolean },
): string {
  if (typeof accelerator === "string") {
    return accelerator;
  }
  return isMac ? accelerator.darwin : accelerator.default;
}
