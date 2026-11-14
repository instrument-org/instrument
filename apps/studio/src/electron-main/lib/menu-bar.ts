import { APP_NAME } from "@instrument-org/shared";
import {
  type Chat,
  type ChatId,
  liveChatList,
} from "@instrument-org/workspace/electron";
import {
  app,
  type BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  type NativeImage,
  nativeImage,
  nativeTheme,
  Tray,
} from "electron";

import askBlack from "../../../resources/menu-bar/askTemplate.png?asset";
import askBlack2x from "../../../resources/menu-bar/askTemplate@2x.png?asset";
import askWhite from "../../../resources/menu-bar/ask-white.png?asset";
import askWhite2x from "../../../resources/menu-bar/ask-white@2x.png?asset";
import idleBlack from "../../../resources/menu-bar/idleTemplate.png?asset";
import idleBlack2x from "../../../resources/menu-bar/idleTemplate@2x.png?asset";
import idleWhite from "../../../resources/menu-bar/idle-white.png?asset";
import idleWhite2x from "../../../resources/menu-bar/idle-white@2x.png?asset";
import workingBlack from "../../../resources/menu-bar/workingTemplate.png?asset";
import workingBlack2x from "../../../resources/menu-bar/workingTemplate@2x.png?asset";
import workingWhite from "../../../resources/menu-bar/working-white.png?asset";
import workingWhite2x from "../../../resources/menu-bar/working-white@2x.png?asset";
import {
  getAppWindows,
  openAppSettings,
} from "@/electron-main/windows/app-window";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import {
  isHeldOffScreen,
  showHeldWindows,
} from "@/electron-main/windows/on-screen";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";

import { setAppMenuQuit } from "./app-menu-quit";
import { logger } from "./electron-logger";
import {
  type MenuBarIcon,
  type MenuBarSection,
  menuBarView,
} from "./menu-bar-rows";
import { keepsRunningInMenuBar } from "./keep-running";

const log = logger.scope("menu-bar");
const IS_MAC = process.platform === "darwin";

/**
 * How long the Dock icon waits to go once the last window is gone: macOS
 * ignores a hide within a second of the last one, and a window that closes as
 * another opens should not flash the icon.
 */
const DOCK_HIDE_DELAY_MS = 1100;

const ICONS = {
  black: {
    ask: [askBlack, askBlack2x],
    idle: [idleBlack, idleBlack2x],
    working: [workingBlack, workingBlack2x],
  },
  white: {
    ask: [askWhite, askWhite2x],
    idle: [idleWhite, idleWhite2x],
    working: [workingWhite, workingWhite2x],
  },
} as const;

let tray: Tray | null = null;
let following: AbortController | null = null;
let chats: readonly Chat[] = [];
let menuOpen = false;
let shownKey = "";
let shownIcon: MenuBarIcon | undefined;
let dockHide: NodeJS.Timeout | undefined;
let reveal: ((id: ChatId) => void) | undefined;

/** Windows hidden by Quit to keep running, which Open Instrument brings back as they were. */
const hiddenByQuit = new Set<BrowserWindow>();

/**
 * The icon for a state, in the color the bar it sits in needs: a template
 * image on a Mac, which the system tints for a light or dark menu bar; black
 * or white on a Windows taskbar by its theme; white on a Linux top bar.
 * Loaded by hand rather than by file name, since the bundler renames assets
 * and macOS finds a template's @2x by name.
 */
function iconFor(state: MenuBarIcon): NativeImage {
  const white =
    process.platform === "linux" ||
    (process.platform === "win32" &&
      nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
  const [oneX, twoX] = ICONS[white ? "white" : "black"][state];
  const image = nativeImage.createFromPath(oneX);
  image.addRepresentation({
    buffer: nativeImage.createFromPath(twoX).toPNG(),
    scaleFactor: 2,
  });
  if (IS_MAC) {
    image.setTemplateImage(true);
  }
  return image;
}

/** A section's name: a header where the Mac draws one, a dimmed row elsewhere. */
function heading(label: string): MenuItemConstructorOptions {
  const macMajor = Number(process.getSystemVersion().split(".")[0]);
  return IS_MAC && macMajor >= 14
    ? { label, type: "header" }
    : { enabled: false, label };
}

function sectionRows(section: MenuBarSection): MenuItemConstructorOptions[] {
  return [
    heading(section.label),
    ...section.chats.map(
      (chat): MenuItemConstructorOptions => ({
        click: () => {
          showDock();
          reveal?.(chat.id);
        },
        label: chat.title,
        // Only the Mac draws a second line under a menu row.
        ...(IS_MAC && chat.line !== undefined && { sublabel: chat.line }),
      }),
    ),
    ...(section.more > 0
      ? [{ click: openInstrument, label: `${section.more} more…` }]
      : []),
  ];
}

function buildMenu(sections: MenuBarSection[]): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...sections.flatMap(sectionRows),
    ...(sections.length > 0 ? [{ type: "separator" } as const] : []),
    { click: openInstrument, label: `Open ${APP_NAME}` },
    {
      click: () => {
        openInstrument();
        openAppSettings();
      },
      label: IS_MAC ? "Settings…" : "Settings",
    },
    { type: "separator" },
    {
      click: () => {
        app.quit();
      },
      label: IS_MAC ? `Quit ${APP_NAME}` : "Quit",
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.on("menu-will-show", () => {
    menuOpen = true;
  });
  menu.on("menu-will-close", () => {
    menuOpen = false;
    // A change that came while the menu was open waits for it to close, so
    // the rows never move under the pointer.
    setImmediate(refresh);
  });
  return menu;
}

/** Brings the icon and the menu up to the chats as they stand. */
function refresh() {
  if (!tray || tray.isDestroyed()) {
    return;
  }
  const { icon, sections } = menuBarView(chats);
  if (icon !== shownIcon) {
    shownIcon = icon;
    tray.setImage(iconFor(icon));
  }
  // Rebuilt only when a row would change, not for every step a turn takes
  // off the Mac, where rows show no step.
  const key = JSON.stringify(
    IS_MAC
      ? sections
      : sections.map((each) => ({
          ...each,
          chats: each.chats.map(({ id, title }) => ({ id, title })),
        })),
  );
  if (menuOpen || key === shownKey) {
    return;
  }
  shownKey = key;
  tray.setContextMenu(buildMenu(sections));
}

/** Follows the chat list for the icon and the menu, until `signal` stops it. */
async function followChats(signal: AbortSignal) {
  try {
    for await (const list of liveChatList(signal)) {
      chats = list;
      refresh();
    }
  } catch (error) {
    if (!signal.aborted) {
      log.error("The menu bar stopped following the chats", error);
    }
  }
}

function showTray() {
  if (tray) {
    return;
  }
  tray = new Tray(iconFor("idle"));
  tray.setToolTip(APP_NAME);
  shownIcon = "idle";
  shownKey = "";
  // Windows opens a tray icon's menu on a right click; a left click opens
  // it too, as the other tray menus there do. macOS and Linux open it on
  // a click already.
  if (process.platform === "win32") {
    tray.on("click", () => {
      tray?.popUpContextMenu();
    });
  }
  following = new AbortController();
  void followChats(following.signal);
  refresh();
}

function hideTray() {
  following?.abort();
  following = null;
  tray?.destroy();
  tray = null;
}

/** Whether a window of the app's is up for the person: shown or in the Dock minimized. */
function anyWindowUp() {
  return getAppWindows().some(
    (window) =>
      window.isVisible() || window.isMinimized() || isHeldOffScreen(window),
  );
}

function showDock() {
  clearTimeout(dockHide);
  dockHide = undefined;
  if (IS_MAC && !app.dock?.isVisible()) {
    void app.dock?.show();
  }
}

/**
 * On a Mac that keeps running in the menu bar, the Dock icon is there only
 * while a window is: with every window gone the app is its menu bar icon.
 * Called as a window comes or goes, never at launch, before the first
 * window may exist.
 */
function syncDock() {
  if (!IS_MAC) {
    return;
  }
  if (!keepsRunningInMenuBar() || anyWindowUp()) {
    showDock();
    return;
  }
  dockHide ??= setTimeout(() => {
    dockHide = undefined;
    if (keepsRunningInMenuBar() && !anyWindowUp()) {
      app.dock?.hide();
    }
  }, DOCK_HIDE_DELAY_MS);
}

/**
 * Brings the app back from its menu bar icon: the windows Quit put away as
 * they were, or the window in front, or a new one.
 */
function openInstrument() {
  showDock();
  // A window waiting off screen (the app restarted to update while no
  // window was showing) comes up as the Dock icon would bring it.
  if (showHeldWindows()) {
    return;
  }
  const hidden = [...hiddenByQuit].filter((window) => !window.isDestroyed());
  hiddenByQuit.clear();
  if (hidden.length === 0) {
    ensureForegroundWindowVisible();
  } else {
    for (const window of hidden.toReversed()) {
      window.show();
    }
    hidden[0]?.focus();
  }
  app.focus({ steal: true });
}

/**
 * What Cmd+Q does on a Mac that keeps running in the menu bar: the windows go
 * away as they are and the work keeps going behind the menu bar icon, whose
 * Quit is the one that stops it. A real quit everywhere else, and once the
 * setting is off.
 */
function quitOrKeepRunning() {
  if (!IS_MAC || !keepsRunningInMenuBar()) {
    app.quit();
    return;
  }
  // The one in front last, so it comes back on top.
  for (const window of getAppWindows().toReversed()) {
    if (window.isVisible() || window.isMinimized()) {
      hiddenByQuit.add(window);
      window.hide();
    }
  }
  syncDock();
}

/**
 * Starts the menu bar (tray) icon, which lists the chats that need the person
 * and those at work, and keeps the Dock icon only while a window is up. Follows
 * the setting, so turning it off takes the icon away and puts the Dock icon
 * back. Called once the workspace has started, since the menu reads its chats.
 */
export function startMenuBar({
  revealChat,
}: {
  revealChat: (id: ChatId) => void;
}) {
  reveal = revealChat;
  setAppMenuQuit(quitOrKeepRunning);
  const apply = () => {
    if (keepsRunningInMenuBar()) {
      showTray();
    } else {
      hideTray();
      // Windows Quit put away come back rather than stay out of reach.
      if (hiddenByQuit.size > 0) {
        openInstrument();
      }
      showDock();
    }
  };
  getMachinePreferences().onDidChange("keepRunningInMenuBar", apply);
  nativeTheme.on("updated", () => {
    shownIcon = undefined;
    refresh();
  });
  app.on("browser-window-created", (_event, window) => {
    const changed = () => {
      if (window.isVisible()) {
        hiddenByQuit.delete(window);
      }
      syncDock();
    };
    window.on("show", changed);
    window.on("hide", changed);
    window.on("closed", changed);
  });
  apply();
}
