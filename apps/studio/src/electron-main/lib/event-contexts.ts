import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { APP_FLAVOR } from "@instrument-org/shared";
import { type EventContexts } from "@instrument-org/shared/exceptions";
import { app } from "electron";

/**
 * Where the app was when an exception was captured: the build, the system,
 * the runtime versions, this process's age and memory, and the language and
 * time zone it reads dates in.
 */
export function eventContexts(): EventContexts {
  return {
    app: {
      channel: readChannel(),
      flavor:
        APP_FLAVOR.kind === "preview"
          ? `preview:${APP_FLAVOR.name}`
          : APP_FLAVOR.kind,
      packaged: app.isPackaged,
      version: app.getVersion(),
    },
    culture: {
      locale: app.getLocale(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    os: {
      arch: process.arch,
      platform: process.platform,
      version: process.getSystemVersion(),
    },
    process: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeMs: Math.round(process.uptime() * 1000),
    },
    runtime: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  };
}

function readChannel(): string {
  try {
    return getMachinePreferences().get("releaseChannel") ?? "latest";
  } catch {
    return "unknown";
  }
}
