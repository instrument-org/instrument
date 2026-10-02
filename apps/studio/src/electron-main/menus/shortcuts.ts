import {
  matchesAccelerator,
  parseAccelerator,
} from "@/electron-main/menus/match-accelerator";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getWorkspacePreferences,
  isDeveloperMode,
} from "@/electron-main/stores/workspace/preferences";
import {
  resolveAccelerator,
  SHORTCUT_ENTRIES,
  type ShortcutAccelerator,
  type ShortcutDescriptor,
  type ShortcutId,
  SHORTCUTS,
} from "@/shared/shortcuts";
import {
  type BaseWindow,
  BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

const IS_MAC = process.platform === "darwin";

type ShortcutAction = (context: {
  /**
   * The window the chord fired against, which the native menu hands us as the
   * `BaseWindow` it might be (a menu accelerator can reach any window, not just
   * the ones we build web contents for).
   */
  focusedWindow?: BaseWindow;
}) => void;

/**
 * What each shortcut in the shared table does in the main process, so adding
 * a descriptor forces a decision here rather than silently landing a dead
 * chord.
 */
const SHORTCUT_ACTIONS: Record<ShortcutId, ShortcutAction> = {
  reloadApp: ({ focusedWindow }) => {
    if (focusedWindow instanceof BrowserWindow) {
      focusedWindow.webContents.reload();
    }
  },
  settings: () => {
    publisher.publish("window.command", "openSettings");
  },
  themeDark: () => {
    getWorkspacePreferences().set("theme", "dark");
  },
  themeLight: () => {
    getWorkspacePreferences().set("theme", "light");
  },
  themeSystem: () => {
    getWorkspacePreferences().set("theme", "system");
  },
};

/**
 * Runs the app's own chords from the raw key event, ahead of the page.
 *
 * A menu accelerator is a fallback, not a binding: Electron offers the native
 * menu only the key events web content left unhandled, so a chord that reaches
 * the app solely through its menu item is at the mercy of whatever has focus --
 * and in Studio that is the prompt editor almost all of the time. Every chord
 * the app owns is bound here so it fires on the key rather than on the page
 * declining it, and `preventDefault` suppresses the matching menu accelerator so
 * it still fires exactly once.
 *
 * The menu keeps its accelerators for display, and for the one case this can't
 * see: a focused browser guest is its own webContents, whose unhandled keys
 * reach the native menu without passing through here.
 *
 * `group` binds one group of the table alone, for a window whose other chords
 * are its own.
 */
export function bindShortcutAccelerators(
  webContents: WebContents,
  { group }: { group?: ShortcutDescriptor["group"] } = {},
) {
  const bound = SHORTCUT_ENTRIES.flatMap(({ descriptor, id }) => {
    const run = SHORTCUT_ACTIONS[id];
    if (group && descriptor.group !== group) {
      return [];
    }
    const chord = resolveMenuAccelerator(descriptor.accelerator);
    return parseAccelerator(chord, { isMac: IS_MAC })
      ? [{ chord, descriptor, run }]
      : [];
  });
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const shortcut = bound.find(
      ({ chord, descriptor }) =>
        // The Developer group only appears in the menu in developer mode, so
        // its chords are only bound there.
        (descriptor.group !== "Developer" || isDeveloperMode()) &&
        matchesAccelerator(input, chord, { isMac: IS_MAC }),
    );
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    shortcut.run({
      focusedWindow: BrowserWindow.fromWebContents(webContents) ?? undefined,
    });
  });
}

/** Projects one table entry into a native menu item. */
export function shortcutMenuItem(id: ShortcutId): MenuItemConstructorOptions {
  const { accelerator, label } = SHORTCUTS[id];
  const run = SHORTCUT_ACTIONS[id];
  return {
    accelerator: resolveMenuAccelerator(accelerator),
    click: (_menuItem, focusedWindow) => {
      run({ focusedWindow });
    },
    label,
  };
}

function resolveMenuAccelerator(accelerator: ShortcutAccelerator) {
  return resolveAccelerator(accelerator, { isMac: IS_MAC });
}
