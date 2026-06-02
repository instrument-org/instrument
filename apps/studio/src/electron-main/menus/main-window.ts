import { publisher } from "@/electron-main/rpc/publisher";
import { isDeveloperMode } from "@/electron-main/stores/preferences";
import { getTabsManager } from "@/electron-main/tabs";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { type MenuItemConstructorOptions } from "electron";

import { captureServerEvent } from "../lib/capture-server-event";
import { getSidebarVisible, setSidebarVisible } from "../stores/app-state";
import {
  createAppMenu,
  createDevToolsMenu,
  createEditMenu,
  createHelpMenu,
} from "./utils";

export function createMainWindowMenu(): MenuItemConstructorOptions[] {
  // While the app-wide modal overlay is open it covers the tabs + sidebar, so
  // tab-structural and sidebar commands are unavailable. Following the macOS
  // convention, we grey them out (enabled: false) rather than removing them,
  // which also reliably swallows their accelerators on all platforms. The menu
  // is rebuilt on modal open/close (see menus/index.ts), so this is re-read.
  const isLocked = getTabsManager()?.studioOverlay.isActive() ?? false;

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        accelerator: "CmdOrCtrl+T",
        click: () => {
          getTabsManager()?.addTab({
            urlPath: "/new-tab",
          });
        },
        enabled: !isLocked,
        label: "New Tab",
      },
      {
        accelerator: "CmdOrCtrl+N",
        click: () => {
          const currentTab = getTabsManager()?.getCurrentTab();
          if (currentTab) {
            currentTab.webView.webContents?.send("navigate", "/new-tab");
            currentTab.webView.webContents?.focus();
          }
        },
        enabled: !isLocked,
        label: "New Task",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+W",
        click: (_menuItem, focusedWindow) => {
          const mainWindow = getMainWindow();
          if (focusedWindow && focusedWindow !== mainWindow) {
            focusedWindow.close();
            return;
          }
          const tabsManager = getTabsManager();
          // While the app-wide modal is open, Cmd+W dismisses it (rather than
          // closing the tab beneath it).
          if (tabsManager?.studioOverlay.isActive()) {
            tabsManager.studioOverlay.dismiss();
            return;
          }
          const selectedTabId = tabsManager?.getState().selectedTabId;
          if (selectedTabId) {
            tabsManager.closeTab({ id: selectedTabId });
          }
        },
        // Stays enabled while the modal is open so Cmd+W can close the modal;
        // the menu is rebuilt on open/close so the label tracks the action.
        label: isLocked ? "Close" : "Close Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+T",
        click: () => {
          getTabsManager()?.reopenClosedTab();
        },
        enabled: !isLocked,
        label: "Reopen Closed Tab",
      },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    role: "viewMenu" as const,
    submenu: [
      {
        accelerator: "CmdOrCtrl+K",
        click: () => {
          const tabsManager = getTabsManager();
          const currentTab = tabsManager?.getCurrentTab();
          if (currentTab?.webView.webContents) {
            publisher.publish("app.toggle-command-menu", {
              webContentsId: currentTab.webView.webContents.id,
            });
            tabsManager?.focusCurrentTab();
          }
        },
        label: "Show Command Menu",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+[",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.goBack();
        },
        label: "Back",
      },
      {
        accelerator: "CmdOrCtrl+]",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.goForward();
        },
        label: "Forward",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+R",
        click: () => {
          const tabsManager = getTabsManager();
          // While the app-wide modal is open it owns the foreground, so reload
          // targets the overlay's webContents instead of the tab beneath it.
          if (tabsManager?.studioOverlay.isActive()) {
            tabsManager.studioOverlay.reload();
            return;
          }
          const currentTab = tabsManager?.getCurrentTab();
          if (currentTab?.webView.webContents) {
            publisher.publish("app.reload", {
              webContentsId: currentTab.webView.webContents.id,
            });
          }
        },
        label: "Reload Page",
      },
      { type: "separator" as const },
      {
        accelerator: "CmdOrCtrl+B",
        click: () => {
          const wasVisible = getSidebarVisible();
          setSidebarVisible(!wasVisible);
          captureServerEvent(
            wasVisible ? "app.sidebar_closed" : "app.sidebar_opened",
          );
        },
        enabled: !isLocked,
        label: getSidebarVisible() ? "Hide Sidebar" : "Show Sidebar",
      },
      { type: "separator" as const },
      { role: "togglefullscreen" as const },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    role: "windowMenu" as const,
    submenu: [
      {
        accelerator: "CmdOrCtrl+0",
        click: () => {
          // Zoom is applied to the tab view only. The sidebar and tab bar use
          // fixed pixel sizes and break if zoomed.
          getTabsManager()?.resetZoom();
        },
        label: "Actual Size",
      },
      {
        accelerator: "CmdOrCtrl+Plus",
        click: () => {
          getTabsManager()?.zoomIn();
        },
        label: "Zoom In",
      },
      {
        // Ctrl+= is what Windows users physically press for zoom
        // in. Electron only matches CmdOrCtrl+Plus on macOS, so we need this
        // duplicate entry for Windows/Linux.
        accelerator: "CmdOrCtrl+=",
        click: () => {
          getTabsManager()?.zoomIn();
        },
        label: "Zoom In",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+-",
        click: () => {
          getTabsManager()?.zoomOut();
        },
        label: "Zoom Out",
      },
      { type: "separator" as const },
      {
        accelerator: "Ctrl+Tab",
        click: () => {
          getTabsManager()?.selectNextTab();
        },
        enabled: !isLocked,
        label: "Show Next Tab",
      },
      {
        accelerator: "Ctrl+Shift+Tab",
        click: () => {
          getTabsManager()?.selectPreviousTab();
        },
        enabled: !isLocked,
        label: "Show Previous Tab",
      },
      {
        accelerator: "CmdOrCtrl+Shift+]",
        click: () => {
          getTabsManager()?.selectNextTab();
        },
        enabled: !isLocked,
        label: "Show Next Tab",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+Shift+[",
        click: () => {
          getTabsManager()?.selectPreviousTab();
        },
        enabled: !isLocked,
        label: "Show Previous Tab",
        visible: false,
      },
      { type: "separator" as const },
      { role: "minimize" as const },
      // zoom and front are macOS-only roles; silently no-ops on Windows/Linux
      ...(process.platform === "darwin"
        ? ([
            { role: "zoom" as const },
            { type: "separator" as const },
            { role: "front" as const },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      {
        accelerator: "CmdOrCtrl+1",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 0 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 1",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+2",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 1 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 2",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+3",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 2 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 3",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+4",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 3 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 4",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+5",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 4 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 5",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+6",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 5 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 6",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+7",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 6 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 7",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+8",
        click: () => {
          const tabsManager = getTabsManager();
          tabsManager?.selectTabByIndex({ index: 7 });
        },
        enabled: !isLocked,
        label: "Switch to Tab 8",
        visible: false,
      },
      {
        accelerator: "CmdOrCtrl+9",
        click: () => {
          const tabsManager = getTabsManager();
          const state = tabsManager?.getState();
          if (state?.tabs.length) {
            tabsManager?.selectTabByIndex({ index: state.tabs.length - 1 });
          }
        },
        enabled: !isLocked,
        label: "Switch to Last Tab",
        visible: false,
      },
    ],
  };

  return [
    createAppMenu(),
    fileMenu,
    createEditMenu(),
    viewMenu,
    windowMenu,
    createHelpMenu(),
    ...(isDeveloperMode() ? createDevToolsMenu() : []),
  ];
}
