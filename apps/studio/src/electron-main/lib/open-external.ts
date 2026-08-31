import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { logger } from "@/electron-main/lib/electron-logger";
import { shell } from "electron";
import { exec, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const log = logger.scope("openExternal");

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

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
      // Workaround for https://github.com/electron/electron/issues/28436
      await new Promise<undefined>((resolve, reject) => {
        const env = { ...process.env };
        delete env.GDK_BACKEND;
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
