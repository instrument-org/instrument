import { app } from "electron";

/** The switch the taskbar's New Window task launches the app with. */
const NEW_WINDOW_SWITCH = "--new-window";

/** Whether a launch was the taskbar's New Window task. */
export function asksForNewWindow(argv: readonly string[]) {
  return argv.includes(NEW_WINDOW_SWITCH);
}

/**
 * Puts New Window in the menu of the app's taskbar button on Windows, as the
 * Dock's menu has it on macOS. A task launches the app again with a switch,
 * which the running app hears as a second launch (`asksForNewWindow`). Only a
 * packaged build, whose executable is the app: a development one's is
 * Electron's own, which would launch nothing.
 */
export function offerNewWindowTask() {
  if (process.platform !== "win32" || !app.isPackaged) {
    return;
  }
  app.setUserTasks([
    {
      arguments: NEW_WINDOW_SWITCH,
      description: "Opens another window",
      iconIndex: 0,
      iconPath: process.execPath,
      program: process.execPath,
      title: "New Window",
    },
  ]);
}
