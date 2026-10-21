import { readSetupState } from "@/electron-main/lib/setup-state";
import { SETUP_STATE_CHANNEL } from "@/shared/constants";
import { ipcMain } from "electron";

/**
 * Answers the preload's synchronous read of where setup is. The window shows
 * on its first paint, and `setup.live.state` answers only once the renderer
 * has connected, so without this a first launch draws the inbox before setup
 * covers it. Registered before any window exists.
 */
export function serveSetupState() {
  ipcMain.on(SETUP_STATE_CHANNEL, (event) => {
    event.returnValue = readSetupState();
  });
}
