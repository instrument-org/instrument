import { publisher, type WindowCommand } from "@/electron-main/rpc/publisher";
import { type BrowserWindow } from "electron";

/**
 * Asks one window of something: a chord pressed in it, a swipe on it, a link
 * the app came forward for. Every window listens on the one stream, and each
 * takes only what names it.
 */
export function commandWindow(window: BrowserWindow, command: WindowCommand) {
  if (!window.isDestroyed()) {
    publisher.publish("window.command", {
      command,
      webContentsId: window.webContents.id,
    });
  }
}
