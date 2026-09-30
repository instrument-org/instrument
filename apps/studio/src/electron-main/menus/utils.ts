import { openExternal } from "@/electron-main/lib/open-external";
import { publisher } from "@/electron-main/rpc/publisher";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { APP_URL, BUG_REPORT_URL, SUPPORT_URL } from "@instrument-org/shared";
import { app, type MenuItemConstructorOptions } from "electron";

import { shortcutMenuItem } from "./shortcuts";

export function createAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    role: "appMenu" as const,
    submenu: [
      { role: "about" as const },
      {
        click: () => {
          publisher.publish("updates.trigger-check", null);
        },
        label: "Check for Updates...",
      },
      { type: "separator" },
      shortcutMenuItem("settings"),
      { type: "separator" },
      { role: "services" as const },
      { type: "separator" },
      { role: "hide" as const },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" },
      { role: "quit" as const },
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
 * `shortcutGuide` opens the keyboard shortcut guide, which only the app
 * window draws; a window without one leaves the item out.
 */
export function createHelpMenu({
  shortcutGuide,
}: { shortcutGuide?: () => void } = {}): MenuItemConstructorOptions {
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
      {
        click: () => {
          void openExternal(SUPPORT_URL);
        },
        label: "Share Feedback",
      },
      {
        click: () => {
          void openExternal(BUG_REPORT_URL);
        },
        label: "Report a Bug",
      },
    ],
  };
}

export function createWindowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    role: "windowMenu" as const,
  };
}
