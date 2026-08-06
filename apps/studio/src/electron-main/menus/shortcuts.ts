import { sendAppCommand } from "@/electron-main/app-command";
import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { isDeveloperMode } from "@/electron-main/stores/preferences";
import {
  focusMainContents,
  goBack,
  goForward,
  reload,
  resetZoom,
  zoomIn,
  zoomOut,
} from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import {
  resolveAccelerator,
  SHORTCUT_ENTRIES,
  type ShortcutAccelerator,
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

// The window the chord fired against, which the native menu hands us as the
// `BaseWindow` it might be (a menu accelerator can reach any window, not just
// the ones we build web contents for).
type ShortcutAction = (focusedWindow?: BaseWindow) => void;

/**
 * What each shortcut in the shared table does in the main process. `null` marks
 * an entry the table only describes -- an Electron role or a hidden
 * accelerator-only item binds the chord elsewhere -- so adding a descriptor
 * forces a decision here rather than silently landing a dead chord.
 */
const SHORTCUT_ACTIONS: Record<ShortcutId, null | ShortcutAction> = {
  closeTab: (focusedWindow) => {
    const mainWindow = getMainWindow();
    if (focusedWindow && focusedWindow !== mainWindow) {
      focusedWindow.close();
      return;
    }
    // The renderer ignores this while an app-wide modal is open (see
    // useAppCommands + blockingModalCountAtom), so open modals stay put.
    sendAppCommand({ type: "close" });
  },
  commandMenu: () => {
    sendAppCommand({ type: "toggleCommandMenu" });
    focusMainContents();
  },
  findInPage: () => {
    sendAppCommand({ type: "findInPage" });
  },
  goBack: () => {
    goBack();
  },
  goForward: () => {
    goForward();
  },
  newTab: () => {
    sendAppCommand({ newTab: true, to: "/new-tab", type: "navigate" });
  },
  newTask: () => {
    sendAppCommand({ to: "/new-tab", type: "navigate" });
  },
  reloadPage: () => {
    reload();
  },
  reloadWebViews: () => {
    // The whole tabbed app is one web contents now, so this reloads it.
    getMainWindow()?.webContents.reload();
  },
  reopenTab: () => {
    sendAppCommand({ type: "reopen" });
  },
  resetZoom: () => {
    // Main-window UI zoom, applied as CSS `zoom` in the renderer; embedded web
    // content views (the agent browser) are left untouched.
    resetZoom();
  },
  selectLastTab: null,
  selectNextTab: () => {
    sendAppCommand({ type: "selectNext" });
  },
  selectPreviousTab: () => {
    sendAppCommand({ type: "selectPrevious" });
  },
  selectTabByIndex: null,
  settings: () => {
    sendAppCommand({ type: "openSettings" });
  },
  shortcutGuide: () => {
    sendAppCommand({ type: "openShortcutGuide" });
  },
  themeDark: () => {
    sendAppCommand({ theme: "dark", type: "setTheme" });
  },
  themeLight: () => {
    sendAppCommand({ theme: "light", type: "setTheme" });
  },
  themeSystem: () => {
    sendAppCommand({ theme: "system", type: "setTheme" });
  },
  toggleFullscreen: null,
  toggleSidebar: () => {
    sendAppCommand({ type: "toggleSidebar" });
  },
  zoomIn: () => {
    zoomIn();
  },
  zoomOut: () => {
    zoomOut();
  },
};

/**
 * Runs the app's own chords from the raw key event, ahead of the page.
 *
 * A menu accelerator is a fallback, not a binding: Electron offers the native
 * menu only the key events web content left unhandled, so a chord that reaches
 * the app solely through its menu item is at the mercy of whatever has focus --
 * and in Studio that is the prompt editor almost all of the time. Every
 * menu-owned entry is bound here so the chord fires on the key rather than on
 * the page declining it, and `preventDefault` suppresses the matching menu
 * accelerator so it still fires exactly once.
 *
 * The menu item keeps its accelerator for display, and for the one case this
 * can't see: a focused browser guest is its own webContents, whose unhandled
 * keys reach the native menu without passing through here.
 */
export function bindShortcutAccelerators(webContents: WebContents) {
  const bound = SHORTCUT_ENTRIES.flatMap(({ descriptor, id }) => {
    const run = SHORTCUT_ACTIONS[id];
    return descriptor.owner === "menu" && run ? [{ descriptor, run }] : [];
  });
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const shortcut = bound.find(
      ({ descriptor }) =>
        // The Developer group only appears in the menu in developer mode, so
        // its chords are only bound there.
        (descriptor.group !== "Developer" || isDeveloperMode()) &&
        matchesAccelerator(
          input,
          resolveMenuAccelerator(descriptor.accelerator),
          { isMac: IS_MAC },
        ),
    );
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    shortcut.run(BrowserWindow.fromWebContents(webContents) ?? undefined);
  });
}

/**
 * Projects one table entry into a native menu item. Renderer-owned chords (the
 * guide's `?`) get the label without an accelerator: the renderer binds those,
 * and the menu item is only a second way in.
 */
export function shortcutMenuItem(id: ShortcutId): MenuItemConstructorOptions {
  const { accelerator, label, owner } = SHORTCUTS[id];
  const run = SHORTCUT_ACTIONS[id];
  return {
    accelerator:
      owner === "menu" ? resolveMenuAccelerator(accelerator) : undefined,
    click: run
      ? (_menuItem, focusedWindow) => {
          run(focusedWindow);
        }
      : undefined,
    label,
  };
}

function resolveMenuAccelerator(accelerator: ShortcutAccelerator) {
  return resolveAccelerator(accelerator, { isMac: IS_MAC });
}
