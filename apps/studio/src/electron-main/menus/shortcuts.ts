import { sendAppCommand } from "@/electron-main/app-command";
import {
  matchesAccelerator,
  parseAccelerator,
} from "@/electron-main/menus/match-accelerator";
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
import { getQuickCaptureOverlayWindow } from "@/electron-main/windows/overlay";
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
   * The chord that ran it: the entry's own accelerator, or one of its
   * `alternates`. Entries whose chord stands for a range of keys read the key
   * back off it.
   */
  accelerator: string;
  /**
   * The window the chord fired against, which the native menu hands us as the
   * `BaseWindow` it might be (a menu accelerator can reach any window, not just
   * the ones we build web contents for).
   */
  focusedWindow?: BaseWindow;
}) => void;

/**
 * What each shortcut in the shared table does in the main process. `null` marks
 * an entry an Electron role performs, so adding a descriptor forces a decision
 * here rather than silently landing a dead chord.
 */
const SHORTCUT_ACTIONS: Record<ShortcutId, null | ShortcutAction> = {
  closeTab: ({ focusedWindow }) => {
    const mainWindow = getMainWindow();
    if (focusedWindow && focusedWindow !== mainWindow) {
      focusedWindow.close();
      return;
    }
    // The renderer ignores this while an app-wide modal is open (see
    // useAppCommands + blockingModalCountAtom), so open modals stay put.
    sendAppCommand({ type: "close" });
  },
  commandMenu: ({ focusedWindow }) => {
    // The quick capture panel has its own search, and this chord would
    // otherwise reach past it to open the main window's palette behind it --
    // in a window the user cannot see from where they are standing.
    if (focusedWindow && focusedWindow === getQuickCaptureOverlayWindow()) {
      return;
    }
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
  reloadApp: () => {
    // The whole tabbed app is one web contents, so this reloads it.
    getMainWindow()?.webContents.reload();
  },
  reloadPage: () => {
    reload();
  },
  reopenTab: () => {
    sendAppCommand({ type: "reopen" });
  },
  resetZoom: () => {
    // Main-window UI zoom, applied as CSS `zoom` in the renderer; embedded web
    // content views (the agent browser) are left untouched.
    resetZoom();
  },
  selectLastTab: () => {
    sendAppCommand({ type: "selectLast" });
  },
  selectNextTab: () => {
    sendAppCommand({ type: "selectNext" });
  },
  selectPreviousTab: () => {
    sendAppCommand({ type: "selectPrevious" });
  },
  selectTabByIndex: ({ accelerator }) => {
    // The digit the chord ends in is the tab: CmdOrCtrl+1 is the first.
    const index = Number(accelerator.split("+").at(-1)) - 1;
    if (Number.isInteger(index) && index >= 0) {
      sendAppCommand({ index, type: "selectByIndex" });
    }
  },
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
 * and in Studio that is the prompt editor almost all of the time. Every chord
 * the app owns is bound here so it fires on the key rather than on the page
 * declining it, and `preventDefault` suppresses the matching menu accelerator so
 * it still fires exactly once.
 *
 * The menu keeps its accelerators for display, and for the one case this can't
 * see: a focused browser guest is its own webContents, whose unhandled keys
 * reach the native menu without passing through here.
 */
export function bindShortcutAccelerators(webContents: WebContents) {
  const bound = SHORTCUT_ENTRIES.flatMap(({ descriptor, id }) => {
    const run = SHORTCUT_ACTIONS[id];
    // A `renderer` chord belongs to the page (see `owner`), so it is never
    // taken here.
    if (!run || descriptor.owner === "renderer") {
      return [];
    }
    return shortcutChords(descriptor).map((chord) => ({
      chord,
      descriptor,
      run,
    }));
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
      accelerator: shortcut.chord,
      focusedWindow: BrowserWindow.fromWebContents(webContents) ?? undefined,
    });
  });
}

/**
 * The accelerator-only menu items behind one entry: its `alternates`, plus its
 * own chord where the menu draws no row for it. They carry no label the user
 * reads, and exist so the chord still reaches a focused browser guest, which
 * the binder above can't see.
 */
export function hiddenShortcutItems(
  id: ShortcutId,
): MenuItemConstructorOptions[] {
  const descriptor = SHORTCUTS[id];
  const run = SHORTCUT_ACTIONS[id];
  if (!run) {
    return [];
  }
  const shown =
    descriptor.owner === "menu"
      ? resolveMenuAccelerator(descriptor.accelerator)
      : undefined;
  return shortcutChords(descriptor)
    .filter((chord) => chord !== shown)
    .map((chord) => ({
      accelerator: chord,
      click: (_menuItem, focusedWindow) => {
        run({ accelerator: chord, focusedWindow });
      },
      label: descriptor.label,
      visible: false,
    }));
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
      ? (menuItem, focusedWindow) => {
          run({ accelerator: menuItem.accelerator ?? "", focusedWindow });
        }
      : undefined,
    label,
  };
}

function resolveMenuAccelerator(accelerator: ShortcutAccelerator) {
  return resolveAccelerator(accelerator, { isMac: IS_MAC });
}

/**
 * Every chord an entry answers to, dropping any the matcher can't read -- which
 * is how a display-only accelerator standing for a range (`CmdOrCtrl+1…8`)
 * leaves only its `alternates` behind.
 */
function shortcutChords(descriptor: ShortcutDescriptor): string[] {
  return [
    resolveMenuAccelerator(descriptor.accelerator),
    ...(descriptor.alternates ?? []),
  ].filter((chord) => parseAccelerator(chord, { isMac: IS_MAC }) !== null);
}
