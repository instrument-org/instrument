import { shell } from "electron";
import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Opens a file, folder, or app on the computer the way a double-click in the
 * system's file manager would, or in `appPath` where one is named (macOS
 * only). Resolves to an error message, empty when it opened.
 *
 * On macOS this runs `open` in a child process. `shell.openPath` there is a
 * synchronous `NSWorkspace openURL:` on the main thread, and an app's
 * first-launch Gatekeeper prompt holds it until the prompt is answered: every
 * window hangs meanwhile, and comes back dropping single clicks until it is
 * deactivated.
 */
export async function openPathOnComputer(
  target: string,
  { appPath }: { appPath?: null | string } = {},
): Promise<string> {
  if (os.platform() !== "darwin") {
    // oxlint-disable-next-line studio/no-shell-open-path -- the one sanctioned call, off macOS
    return shell.openPath(target);
  }
  try {
    await execFileAsync("open", appPath ? ["-a", appPath, target] : [target]);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn't open the path";
  }
}
