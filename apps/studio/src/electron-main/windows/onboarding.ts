import { createContextMenu } from "@/electron-main/lib/context-menu";
import { openExternal } from "@/electron-main/lib/open-external";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { app, BrowserWindow } from "electron";
import path from "node:path";

const ONBOARDING_WIDTH = 480;
const ONBOARDING_HEIGHT = 600;

let onboardingWindow: BrowserWindow | null = null;

export function closeOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
  }
  onboardingWindow = null;
}

export function getOnboardingWindow(): BrowserWindow | null {
  return onboardingWindow;
}

export function openOnboardingWindow(): BrowserWindow {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus();
    return onboardingWindow;
  }

  onboardingWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: getBackgroundColor(),
    fullscreenable: false,
    height: ONBOARDING_HEIGHT,
    maximizable: false,
    resizable: false,
    show: false,
    title: "Welcome",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      additionalArguments: ["--windowType=onboarding"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
    },
    width: ONBOARDING_WIDTH,
  });

  onboardingWindow.once("ready-to-show", () => {
    onboardingWindow?.show();
  });

  onboardingWindow.on("closed", () => {
    onboardingWindow = null;
    publisher.publish("window.focus-changed", null);
    // If the main window hasn't been created yet (i.e. onboarding was
    // dismissed without completing), quit the app on all platforms.
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      app.quit();
    }
  });

  onboardingWindow.on("focus", () => {
    publisher.publish("window.focus-changed", null);
  });

  onboardingWindow.setBackgroundColor(getBackgroundColor());

  onboardingWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  void onboardingWindow.loadURL(studioURL("/onboarding"));

  createContextMenu({ windowOrWebContentsView: onboardingWindow });

  return onboardingWindow;
}

export function updateOnboardingWindowBackgroundColor() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.setBackgroundColor(getBackgroundColor());
  }
}
