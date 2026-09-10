import { getMainWindow } from "@/electron-main/windows/main/instance";
import { BrowserWindow, webContents } from "electron";

/**
 * The window whose renderer made the call.
 *
 * Window chrome belongs to one window: the buttons a window draws for itself
 * have to move that window and no other, and the state they draw is its own.
 * Answering with the main window for a caller that is not a window -- a guest,
 * a contents already torn down -- leaves those callers where they were.
 */
export function getCallingWindow(webContentsId: number): BrowserWindow | null {
  const contents = webContents.fromId(webContentsId);
  const window = contents ? BrowserWindow.fromWebContents(contents) : null;
  return window ?? getMainWindow();
}
