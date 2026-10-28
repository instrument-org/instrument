import { openExternal } from "@/electron-main/lib/open-external";
import { publisher } from "@/electron-main/rpc/publisher";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { resolveAccelerator } from "@/shared/shortcuts";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { APP_URL, SUPPORT_URL } from "@instrument-org/shared";
import { app, type MenuItemConstructorOptions } from "electron";

import { shortcutMenuItem } from "./shortcuts";

const IS_MAC = process.platform === "darwin";

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
      }
    : {
        click: () => {
          publisher.publish("updates.trigger-check", null);
        },
        label: "Check for Updates…",
      };
}

export function createAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    role: "appMenu" as const,
    submenu: [
      { role: "about" as const },
      updateMenuItem(updateReady),
      { type: "separator" },
      shortcutMenuItem("settings"),
      { type: "separator" },
      // Services and hiding are the Mac's alone; Electron binds Hide to the
      // Super key elsewhere, which the desktop takes for itself.
      ...(IS_MAC
        ? ([
            { role: "services" as const },
            { type: "separator" },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        accelerator: resolveAccelerator(
          WINDOW_MENU_SHORTCUTS.quit.accelerator,
          {
            isMac: IS_MAC,
          },
        ),
        role: "quit" as const,
      },
    ],
  };
}

export function createDevToolsMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: "🐛 Dev",
      submenu: [
        shortcutMenuItem("reloadApp"),
        { type: "separator" as const },
        shortcutMenuItem("themeLight"),
        shortcutMenuItem("themeDark"),
        shortcutMenuItem("themeSystem"),
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
 * window without them leaves the guide out and sends feedback to the
 * website's support page.
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
      ...(shortcutGuide
        ? ([
            // No accelerator: the guide's `?` is the renderer's to answer,
            // since a bare key has to yield to whatever is being typed into.
            { click: shortcutGuide, label: SHORTCUT_GUIDE.label },
            { type: "separator" },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        click: () => {
          void openExternal(APP_URL);
        },
        label: "Learn More",
      },
      // The app window answers feedback itself, with the log and versions
      // the person can read before sending; a window without the dialog
      // sends people to the website's support page.
      reportProblem
        ? { click: reportProblem, label: "Send Feedback…" }
        : {
            click: () => {
              void openExternal(SUPPORT_URL);
            },
            label: "Send Feedback",
          },
    ],
  };
}

/**
 * The Window menu, on a Mac alone. Elsewhere the window draws its own
 * minimize, maximize and close buttons, the system has its own keys for
 * them, and Electron's Window menu would bind Ctrl+M to minimize and Ctrl+W
 * to close the window, which wins over Close Tab for a key a focused page
 * leaves to the menu.
 */
export function createWindowMenu(): MenuItemConstructorOptions[] {
  return IS_MAC ? [{ label: "Window", role: "windowMenu" as const }] : [];
}
