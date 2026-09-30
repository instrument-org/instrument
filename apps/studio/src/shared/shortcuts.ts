/**
 * The app menu's own chords and the Developer menu's, as data. One entry feeds
 * the native menu (which projects it into a menu item) and the accelerator
 * binder in the main process, so the two cannot drift. The window's own
 * chords are `window-shortcuts.ts`.
 *
 * Descriptors are serializable on purpose, so a renderer can show a chord;
 * actions live beside the process that can perform them
 * (`electron-main/menus/shortcuts.ts`).
 */

/** Electron-shaped accelerator, or one per platform where the chords differ. */
export type ShortcutAccelerator = string | { darwin: string; default: string };

export interface ShortcutDescriptor {
  /** The chord the menu shows. */
  accelerator: ShortcutAccelerator;
  /**
   * The Developer group only appears in the menu in developer mode, so its
   * chords are only bound there.
   */
  group: "Developer" | "General";
  label: string;
}

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUTS = {
  reloadApp: {
    accelerator: "CmdOrCtrl+Shift+R",
    group: "Developer",
    label: "Reload App",
  },
  settings: {
    accelerator: "CmdOrCtrl+,",
    group: "General",
    label: "Settings...",
  },
  themeDark: {
    accelerator: "CmdOrCtrl+Shift+D",
    group: "Developer",
    label: "Set Theme: Dark",
  },
  themeLight: {
    accelerator: "CmdOrCtrl+Shift+L",
    group: "Developer",
    label: "Set Theme: Light",
  },
  themeSystem: {
    accelerator: "CmdOrCtrl+Shift+M",
    group: "Developer",
    label: "Set Theme: System",
  },
} satisfies Record<string, ShortcutDescriptor>;

/**
 * The table as a list, for the consumers that walk every entry rather than
 * naming one. Key order is lint-sorted and carries no meaning.
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
