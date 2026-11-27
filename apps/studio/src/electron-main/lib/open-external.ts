import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { logger } from "@/electron-main/lib/electron-logger";
import { settingsLinkSchemeOf } from "@/shared/settings-links";
import { shell } from "electron";
import { exec, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const log = logger.scope("openExternal");

// Beside the web, mail and phone, a link may open a page of this system's own
// settings, and only this system's: it shows a pane, and the person makes the
// change there.
const SAFE_PROTOCOLS = new Set(
  [
    "http:",
    "https:",
    "mailto:",
    "tel:",
    settingsLinkSchemeOf(os.platform()),
  ].filter((protocol) => protocol !== undefined),
);

export async function openExternal(url: string): Promise<boolean> {
  // Only allow safe protocols for external links
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol.toLowerCase();

    if (!SAFE_PROTOCOLS.has(protocol)) {
      // The URL originates in model output and can name a local file path or
      // carry task content, so it stays in the local log; the captured
      // message carries only the protocol, which is what groups the reports.
      log.warn(`Blocked unsafe protocol ${protocol}: ${url}`);
      captureServerException(
        new Error(
          `Blocked attempt to open URL with unsafe protocol: ${protocol}`,
        ),
      );
      return false;
    }
  } catch (error) {
    // Invalid URL format
    log.warn(`Invalid URL format: ${url}`);
    captureServerException(
      new Error("Invalid URL format in openExternal", { cause: error }),
    );
    return false;
  }

  if (os.platform() === "linux") {
    try {
      await execAsync("which xdg-open");
      // Opening a link in Firefox on Ubuntu under Wayland failed with
      // Electron's XDG_CURRENT_DESKTOP set, so xdg-open runs without it.
      await new Promise<undefined>((resolve, reject) => {
        const env = { ...process.env };
        delete env.XDG_CURRENT_DESKTOP;

        const child = spawn("xdg-open", [url], {
          detached: true,
          env,
          stdio: "ignore",
        });

        child.on("error", (error) => {
          captureServerException(error);
          reject(error);
        });

        child.unref();
        resolve(undefined);
      });
      return true;
    } catch {
      // xdg-open not available, fall back to shell.openExternal
    }
  }

  await shell.openExternal(url);
  return true;
}
