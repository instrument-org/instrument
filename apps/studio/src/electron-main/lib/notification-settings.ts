import { logger } from "@/electron-main/lib/electron-logger";
import { bundleIdentifier } from "@/electron-main/lib/mac-native";
import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

const log = logger.scope("notificationSettings");

/**
 * Where the system keeps this app's notification settings: an address the
 * system opens, or a program that opens at the page.
 */
type NotificationSettingsTarget =
  | { args: string[]; command: string; kind: "command" }
  | { kind: "url"; url: string };

/**
 * The system's notification settings, or none where no page can be opened
 * reliably. macOS won't let an app prompt for notification permission, so
 * its settings pane is the best on offer to someone who isn't seeing
 * notifications; the `?id=` hint selects the row of `bundleId`, the running
 * app's own, which in a development run is Electron's rather than the
 * build's (honored on Ventura and later, otherwise it lands on the
 * Notifications list). Windows has one address for every app. On Linux only
 * GNOME has a page to open, and its Settings app refuses to start under any
 * other desktop.
 */
export async function notificationSettingsTarget({
  bundleId,
  env,
  platform,
}: {
  bundleId?: string;
  env: { PATH?: string; XDG_CURRENT_DESKTOP?: string };
  platform: NodeJS.Platform;
}): Promise<NotificationSettingsTarget | undefined> {
  switch (platform) {
    case "darwin": {
      return {
        kind: "url",
        url: `x-apple.systempreferences:com.apple.preference.notifications?id=${bundleId ?? APP_BUNDLE_ID}`,
      };
    }
    case "win32": {
      return { kind: "url", url: "ms-settings:notifications" };
    }
    case "linux": {
      const desktops = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
      if (!desktops.includes("gnome")) {
        return undefined;
      }
      const command = await findOnPath("gnome-control-center", env.PATH);
      return command
        ? { args: ["notifications"], command, kind: "command" }
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/** Opens the system's notification settings, and says whether there were any to open. */
export async function openNotificationSettings(): Promise<boolean> {
  const target = await notificationSettingsTarget({
    bundleId: await bundleIdentifier(),
    env: process.env,
    platform: process.platform,
  });
  if (target === undefined) {
    return false;
  }
  if (target.kind === "url") {
    await shell.openExternal(target.url);
    return true;
  }
  return new Promise((resolve) => {
    const child = spawn(target.command, target.args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", (error) => {
      log.warn(`Couldn't start ${target.command}`, error);
      resolve(false);
    });
  });
}

/** The first executable named `name` on a `PATH`, by its full path. */
async function findOnPath(name: string, searchPath = "") {
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder; try the next one.
    }
  }
  return undefined;
}
