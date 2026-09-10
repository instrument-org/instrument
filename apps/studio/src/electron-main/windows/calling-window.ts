import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { BrowserWindow, webContents } from "electron";

/**
 * The window whose renderer made the call.
 *
 * Window chrome and native dialogs belong to one window: the buttons a window
 * draws for itself have to move that window and no other, the state they draw
 * is its own, and a sheet has to cover the window it is asking about. Where the
 * caller is not a window at all -- a guest, a contents already torn down -- the
 * answer is whichever window is in front, which under Instrument 2.0 is not the
 * classic window kept hidden behind it.
 */
export function getCallingWindow(webContentsId: number): BrowserWindow | null {
  const contents = webContents.fromId(webContentsId);
  const window = contents ? BrowserWindow.fromWebContents(contents) : null;
  return window ?? getForegroundWindow();
}
