import { app } from "electron";

export type DisplayProtocol = "wayland" | "x11";

/**
 * The display protocol this run talks on Linux, which Electron chooses before
 * any of the app's code runs and names in `--ozone-platform`: Wayland in a
 * Wayland session, X11 otherwise, or whatever the launch passed.
 * `--ozone-platform=x11` is the way back to XWayland for anyone a Wayland
 * problem finds.
 */
export function displayProtocol(): DisplayProtocol {
  return app.commandLine.getSwitchValue("ozone-platform") === "wayland"
    ? "wayland"
    : "x11";
}
