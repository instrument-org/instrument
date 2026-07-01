import { publisher } from "@/electron-main/rpc/publisher";
import {
  createStudioOverlayController,
  type StudioOverlayController,
} from "@/electron-main/tabs/studio-overlay";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { type BaseWindow } from "electron";

// The app-wide modal overlay (a topmost WebContentsView) as a process
// singleton, so menus/RPC can reach it directly. Created with the main window,
// torn down with it.
let controller: StudioOverlayController | undefined;

export function createStudioOverlay({
  baseWindow,
}: {
  baseWindow: BaseWindow;
}) {
  controller = createStudioOverlayController({
    baseWindow,
    onActiveChange: (isActive) => {
      publisher.publish("studio-overlay.active-changed", { isActive });
    },
    onClosed: () => {
      // The overlay had focus while open; hand it back to the tab contents.
      getMainWindow()?.webContents.focus();
    },
  });
  return controller;
}

export function getStudioOverlay() {
  return controller;
}

export function teardownStudioOverlay() {
  controller?.teardown();
  controller = undefined;
}
