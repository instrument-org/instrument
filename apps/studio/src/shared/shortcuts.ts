/**
 * Every keyboard shortcut the app declares, as data. One entry feeds the native
 * menu (which projects it into a menu item), the reserved-chord binder in the
 * main process, and the in-app shortcut guide, so adding a chord is one edit and
 * no surface can drift from another.
 *
 * Descriptors are serializable on purpose: the renderer needs `label`,
 * `accelerator` and `group` to draw the guide, and none of that can travel with
 * a `run` closing over main-process state. Actions live beside the process that
 * can perform them (`electron-main/menus/shortcuts.ts`).
 */

/** Electron-shaped accelerator, or one per platform where the chords differ. */
export type ShortcutAccelerator = string | { darwin: string; default: string };

export interface ShortcutDescriptor {
  accelerator: ShortcutAccelerator;
  /** Section the guide lists this under. Menu placement is the menu's own business. */
  group: ShortcutGroup;
  label: string;
  /**
   * Who binds the chord:
   *
   * - `menu` -- the native menu item this entry is projected into.
   * - `renderer` -- a renderer keydown, for a chord that is layout-dependent or
   *   has to yield to a focused editor. The menu can still offer the item, just
   *   without an accelerator.
   * - `external` -- something outside the table already handles it: an Electron
   *   role, or a hidden accelerator-only menu item. Listed so the guide can show
   *   it, never projected into a menu item.
   */
  owner: "external" | "menu" | "renderer";
  /**
   * Whether the chord has to beat the focused page. Electron offers the native
   * menu only the key events web content left unhandled, and Chromium keeps the
   * editing chords for itself whenever a contenteditable has focus, so an
   * unreserved chord stops working the moment the caret enters the prompt
   * editor. Reserve only what the app owns outright: anything an editor
   * legitimately uses (Mod-Z to undo) belongs to the page.
   */
  reserved?: boolean;
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
  // Hidden accelerator-only items in the Window menu, so the chords exist
  // without adding ten rows to it; the guide shows them as two.
  selectLastTab: {
    accelerator: "CmdOrCtrl+9",
    group: "Tabs",
    label: "Switch to Last Tab",
    owner: "external",
  },
  selectNextTab: {
    accelerator: "Ctrl+Tab",
    group: "Tabs",
    label: "Show Next Tab",
    owner: "menu",
  },
  selectPreviousTab: {
    accelerator: "Ctrl+Shift+Tab",
    group: "Tabs",
    label: "Show Previous Tab",
    owner: "menu",
  },
  selectTabByIndex: {
    accelerator: "CmdOrCtrl+1…8",
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
    reserved: true,
  },
  zoomIn: {
    accelerator: "CmdOrCtrl+Plus",
    group: "View",
    label: "Zoom In",
    owner: "menu",
  },
  zoomOut: {
    accelerator: "CmdOrCtrl+-",
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
