import { app } from "electron";

let simulated = false;

/**
 * Whether web pages run without Chromium's own sandbox here: an AppImage
 * started with `--no-sandbox`, which electron-builder's AppRun adds where
 * the kernel refuses the user namespaces Chromium's sandbox needs (Ubuntu's
 * AppArmor restriction on an app with no profile). Read from what the
 * process was started with, so it is exact.
 */
export function chromiumSandboxOff(): boolean {
  return (
    simulated ||
    (process.platform === "linux" &&
      process.env.APPIMAGE !== undefined &&
      (app.commandLine.hasSwitch("no-sandbox") ||
        process.argv.includes("--no-sandbox")))
  );
}

/** Reports the browser's sandbox as off, for checking its notice anywhere. */
export function simulateChromiumSandboxOff(off: boolean): void {
  simulated = off;
}
