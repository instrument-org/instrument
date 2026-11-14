import { openExternal } from "@/electron-main/lib/open-external";
import { publisher, type WindowCommand } from "@/electron-main/rpc/publisher";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import { getAppZoom } from "@/electron-main/stores/workspace/window-state";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { resolveAccelerator } from "@/shared/shortcuts";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { SUPPORT_URL } from "@instrument-org/shared";
import { commandWindow } from "@/electron-main/windows/window-command";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";

import { shortcutMenuItem } from "./shortcuts";
import { menuSymbol } from "./symbol";

const IS_MAC = process.platform === "darwin";

/** A menu row that asks the window it was chosen in, where one is. */
function commandsFocusedWindow(command: WindowCommand) {
  return (
    _item: Electron.MenuItem,
    window: Electron.BaseWindow | undefined,
  ) => {
    if (window instanceof BrowserWindow) {
      commandWindow(window, command);
    }
  };
}

let updateReady = false;

/**
 * Records whether an update is ready to install, which the app menu's update
 * item names. Answers whether that changed, so the menu is rebuilt only then.
 */
export function setMenuUpdateReady(ready: boolean): boolean {
  if (ready === updateReady) {
    return false;
  }
  updateReady = ready;
  return true;
}

/**
 * The app menu's update item: it checks for updates, or, while one is ready,
 * installs it as the Update pill does.
 */
export function updateMenuItem(ready: boolean): MenuItemConstructorOptions {
  return ready
    ? {
        click: () => {
          publisher.publish("updates.trigger-install", null);
        },
        label: "Restart to Update",
        ...menuSymbol("arrow.triangle.2.circlepath"),
      }
    : {
        click: () => {
          publisher.publish("updates.trigger-check", null);
        },
        label: "Check for Updates…",
        ...menuSymbol("arrow.down.circle"),
      };
}

/**
 * The rows a Mac keeps in the menu named for the app, written once for every
 * system: `withAppMenu` decides where they go.
 */
function appRows() {
  return {
    about: { role: "about" as const },
    quit: {
      ...(!(
        process.platform === "win32" &&
        WINDOW_MENU_SHORTCUTS.quit.noChordOnWindows
      ) && {
        accelerator: resolveAccelerator(
          WINDOW_MENU_SHORTCUTS.quit.accelerator,
          { isMac: IS_MAC },
        ),
      }),
      // Electron names it Exit on Windows and Quit on Linux.
      role: "quit" as const,
    },
    settings: { ...shortcutMenuItem("settings"), ...menuSymbol("gear") },
    update: updateMenuItem(updateReady),
  } satisfies Record<string, MenuItemConstructorOptions>;
}

/** The Mac's menu named for the app. */
function createAppMenu(): MenuItemConstructorOptions {
  const { about, quit, settings, update } = appRows();
  return {
    label: app.getName(),
    role: "appMenu" as const,
    submenu: [
      about,
      update,
      { type: "separator" },
      settings,
      { type: "separator" },
      { role: "services" as const },
      { type: "separator" },
      { role: "hide" as const },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" },
      quit,
    ],
  };
}

/**
 * Off the Mac, each menu's access key: the letter that opens it while the
 * menu is up, which Electron underlines. History takes its s, since Help has
 * the h on Windows.
 */
const ACCESS_KEYS: Record<string, string> = { History: "Hi&story" };

/** Where the app's own rows go off the Mac, at the foot of these menus. */
const APP_ROW_PLACES = {
  File: ["settings", "quit"],
  Help: ["update", "about"],
} as const satisfies Record<string, (keyof ReturnType<typeof appRows>)[]>;

/**
 * A window's menus with the app's own rows (About, updates, Settings, Quit)
 * where this system's apps keep them. On a Mac they are the menu named for
 * the app, at the head of the bar. Windows and Linux apps have no such menu:
 * Settings and Quit end File, and updates and About end Help, each after a
 * separator, and every menu takes an access key. Off the Mac the window's
 * menu also opens on F10, the key both systems open an app's menus with.
 */
export function withAppMenu(
  menus: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  if (IS_MAC) {
    return [createAppMenu(), ...menus];
  }
  const rows = appRows();
  return menus.map((menu) => {
    const label = menu.label ?? "";
    const places: Record<string, readonly (keyof typeof rows)[]> =
      APP_ROW_PLACES;
    const placed = (places[label] ?? []).flatMap((key) => [
      { type: "separator" as const },
      rows[key],
    ]);
    return {
      ...menu,
      label: ACCESS_KEYS[label] ?? `&${label}`,
      ...(placed.length > 0 && Array.isArray(menu.submenu)
        ? {
            submenu: [
              ...menu.submenu,
              ...placed,
              ...(label === "File" ? [menuKeyItem()] : []),
            ],
          }
        : {}),
    };
  });
}

/**
 * F10 as a hidden row, so it reaches the menu from a focused page guest too:
 * it opens the window's menu under the bar's left corner, told it came from
 * the keyboard, where the arrows walk it and a letter opens a menu.
 */
function menuKeyItem(): MenuItemConstructorOptions {
  return {
    accelerator: "F10",
    click: (_item, focusedWindow) => {
      if (!focusedWindow) {
        return;
      }
      const zoom = getAppZoom();
      Menu.getApplicationMenu()?.popup({
        sourceType: "keyboard",
        window: focusedWindow,
        x: Math.round(8 * zoom),
        y: Math.round(TOOLBAR_HEIGHT * zoom),
      });
    },
    label: "Show Menu",
    visible: false,
  };
}

export function createDevToolsMenu({
  windowCommands = false,
}: {
  /** Whether a shell is listening for the window's commands: the app window's, with setup down. */
  windowCommands?: boolean;
} = {}): MenuItemConstructorOptions[] {
  return [
    {
      label: "Developer",
      submenu: [
        {
          ...shortcutMenuItem("reloadApp"),
          ...menuSymbol("arrow.clockwise.circle"),
        },
        {
          label: "Open Developer Tools",
          role: "toggleDevTools" as const,
          ...menuSymbol("hammer"),
        },
        ...(windowCommands
          ? [
              {
                click: commandsFocusedWindow("openDebugPages"),
                label: "Debug Pages",
                ...menuSymbol("ladybug"),
              },
              { ...shortcutMenuItem("captureWindow"), ...menuSymbol("camera") },
              {
                click: commandsFocusedWindow("toggleDeveloperStrip"),
                label: "Toggle Developer Strip",
                ...menuSymbol("rectangle.bottomhalf.filled"),
              },
            ]
          : []),
        { type: "separator" as const },
        { ...shortcutMenuItem("themeLight"), ...menuSymbol("sun.max") },
        { ...shortcutMenuItem("themeDark"), ...menuSymbol("moon") },
        {
          ...shortcutMenuItem("themeSystem"),
          ...menuSymbol("circle.lefthalf.filled"),
        },
        { type: "separator" as const },
        {
          click: () => {
            getWorkspacePreferences().set("developerMode", false);
          },
          label: "Turn Off Developer Mode",
          ...menuSymbol("power"),
        },
      ],
    },
  ];
}

export function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    role: "editMenu" as const,
  };
}

/**
 * `shortcutGuide` opens the keyboard shortcut guide and `reportProblem` the
 * report dialog, which only the app window draws once setup is done; a
 * window without them leaves both out, and Support is its way to reach us.
 * The order matches the app rail's Help menu.
 */
export function createHelpMenu({
  reportProblem,
  shortcutGuide,
}: {
  reportProblem?: () => void;
  shortcutGuide?: () => void;
} = {}): MenuItemConstructorOptions {
  return {
    label: "Help",
    role: "help" as const,
    submenu: [
      ...(reportProblem
        ? ([
            {
              click: reportProblem,
              label: "Send Feedback…",
              ...menuSymbol("exclamationmark.bubble"),
            },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        click: () => {
          void openExternal(SUPPORT_URL);
        },
        label: "Support",
        ...menuSymbol("questionmark.circle"),
      },
      ...(shortcutGuide
        ? ([
            { type: "separator" },
            // No accelerator: the guide's `?` is the renderer's to answer,
            // since a bare key has to yield to whatever is being typed into.
            {
              click: shortcutGuide,
              label: SHORTCUT_GUIDE.label,
              ...menuSymbol("keyboard"),
            },
          ] satisfies MenuItemConstructorOptions[])
        : []),
    ],
  };
}

/**
 * The Window menu. Only a Mac has Electron's: elsewhere the window draws its
 * own minimize, maximize and close buttons, the system has its own keys for
 * them, and Electron's Window menu would bind Ctrl+M to minimize and Ctrl+W
 * to close the window, which wins over Close Tab for a key a focused page
 * leaves to the menu. There it is only the items given, if any.
 */
export function createWindowMenu(
  windowItems: MenuItemConstructorOptions[] = [],
): MenuItemConstructorOptions[] {
  if (!IS_MAC) {
    return windowItems.length > 0
      ? [{ label: "Window", submenu: windowItems }]
      : [];
  }
  return [
    {
      label: "Window",
      role: "windowMenu" as const,
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(windowItems.length > 0
          ? [{ type: "separator" as const }, ...windowItems]
          : []),
        { type: "separator" as const },
        { role: "front" as const },
      ],
    },
  ];
}
