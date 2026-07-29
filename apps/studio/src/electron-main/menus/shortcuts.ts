import { sendAppCommand } from "@/electron-main/app-command";
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
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

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
 * Runs the reserved shortcuts ahead of the page's own key handling.
 * `preventDefault` here also suppresses the matching menu accelerator, so each
 * chord still fires exactly once.
 */
export function bindReservedShortcuts(webContents: WebContents) {
  const reserved = SHORTCUT_ENTRIES.flatMap(({ descriptor, id }) => {
    const run = SHORTCUT_ACTIONS[id];
    return descriptor.reserved && run ? [{ descriptor, run }] : [];
  });
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const shortcut = reserved.find(({ descriptor }) =>
      matchesAccelerator(input, resolveMenuAccelerator(descriptor.accelerator)),
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

// Reserving a chord means matching it against a raw key event, which only
// `CmdOrCtrl+<key>` accelerators do here. Anything richer never matches rather
// than matching loosely, so a shortcut that outgrows the shape fails loudly the
// first time it's pressed instead of firing on the wrong chord.
function matchesAccelerator(input: Input, accelerator: string) {
  const [modifier, key, ...rest] = accelerator.split("+");
  if (modifier !== "CmdOrCtrl" || !key || rest.length > 0) {
    return false;
  }
  if (
    input.alt ||
    input.shift ||
    input.key.toLowerCase() !== key.toLowerCase()
  ) {
    return false;
  }
  return process.platform === "darwin"
    ? input.meta && !input.control
    : input.control && !input.meta;
}

function resolveMenuAccelerator(accelerator: ShortcutAccelerator) {
  return resolveAccelerator(accelerator, {
    isMac: process.platform === "darwin",
  });
}
