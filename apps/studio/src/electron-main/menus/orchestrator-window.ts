import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { publisher } from "@/electron-main/rpc/publisher";
import { getFeaturesStore } from "@/electron-main/stores/features";
import { ensureMainWindowVisible } from "@/electron-main/windows/main";
import { type MenuItemConstructorOptions } from "electron";

import { isDeveloperMode } from "../stores/preferences";
import { createOtherWindowViewMenu } from "./other-window";
import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
  createWindowMenu,
} from "./utils";

/**
 * The orchestrator window's menu: the other windows' menu, but with the
 * chords a browser has. Cmd+W closes the tab on screen and never the window,
 * which has tabs the user may be keeping; the window closes on Shift+Cmd+W.
 */
export function createOrchestratorWindowMenu(): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        accelerator: "CmdOrCtrl+T",
        click: () => {
          publisher.publish("orchestrator.command", "newTab");
        },
        label: "New Tab",
      },
      {
        accelerator: "CmdOrCtrl+W",
        click: () => {
          publisher.publish("orchestrator.command", "closeTab");
        },
        label: "Close Tab",
      },
      {
        accelerator: "Shift+CmdOrCtrl+T",
        click: () => {
          publisher.publish("orchestrator.command", "reopenTab");
        },
        label: "Reopen Closed Tab",
      },
      {
        accelerator: "Shift+CmdOrCtrl+W",
        label: "Close Window",
        role: "close" as const,
      },
      { type: "separator" as const },
      {
        // The classic window, shown again, and the next launch starts there.
        click: () => {
          getFeaturesStore().set("instrument_2", false);
          void ensureMainWindowVisible();
        },
        label: "Switch to Classic Instrument",
      },
    ],
  };

  // The chords the main window's tab bar answers to, on whichever screen is
  // up here: next and previous by Ctrl+Tab and by Cmd+Shift+bracket, a tab by
  // place with Cmd+1 through Cmd+8, and the last with Cmd+9, as browsers do.
  const tabMenu: MenuItemConstructorOptions = {
    label: "Tabs",
    submenu: [
      {
        accelerator: "Ctrl+Tab",
        click: () => {
          publisher.publish("orchestrator.command", "nextTab");
        },
        label: "Show Next Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+]",
        click: () => {
          publisher.publish("orchestrator.command", "nextTab");
        },
        label: "Show Next Tab",
        visible: false,
      },
      {
        accelerator: "Ctrl+Shift+Tab",
        click: () => {
          publisher.publish("orchestrator.command", "previousTab");
        },
        label: "Show Previous Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+[",
        click: () => {
          publisher.publish("orchestrator.command", "previousTab");
        },
        label: "Show Previous Tab",
        visible: false,
      },
      { type: "separator" },
      ...Array.from({ length: 9 }, (_, index) => ({
        accelerator: `CmdOrCtrl+${index + 1}`,
        click: () => {
          publisher.publish("orchestrator.command", {
            index: index + 1,
            type: "selectTab",
          });
        },
        label: index === 8 ? "Last Tab" : `Tab ${index + 1}`,
      })),
    ],
  };

  const historyMenu: MenuItemConstructorOptions = {
    label: "History",
    submenu: [
      // A focused browser guest navigates its own history, the way the main
      // window's does; otherwise the window's screens do.
      {
        accelerator: "CmdOrCtrl+[",
        click: () => {
          if (!getBrowserViewManager()?.navigateFocusedGuest("back")) {
            publisher.publish("orchestrator.command", "back");
          }
        },
        label: "Back",
      },
      {
        accelerator: "CmdOrCtrl+]",
        click: () => {
          if (!getBrowserViewManager()?.navigateFocusedGuest("forward")) {
            publisher.publish("orchestrator.command", "forward");
          }
        },
        label: "Forward",
      },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    createOtherWindowViewMenu(),
    tabMenu,
    historyMenu,
    createWindowMenu(),
    createHelpMenu({ includeShortcutGuide: false }),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
