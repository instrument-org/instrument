import {
  platformApiQueryClient,
  platformApiRpcClient,
} from "@/electron-main/platform-api/client";
import { publisher } from "@/electron-main/rpc/publisher";
import { MANUAL_DOWNLOAD_URL } from "@instrument-org/shared";
import { app } from "electron";
import ms from "ms";
import { isEqual } from "radashi";
import semver from "semver";

import { logger } from "./electron-logger";

const scopedLogger = logger.scope("appUpdates");

// What the renderer needs to render the minimum-version block. `required` gates
// the full-screen `UpdateRequiredScreen`; `downloadUrl` is the manual/escape
// hatch link the server can override per-incident.
export interface AppUpdateRequirement {
  downloadUrl: string;
  message?: string;
  required: boolean;
}

// Fetches the server-controlled update config and derives whether this build is
// below the minimum supported version. The result is exposed synchronously for
// late RPC subscribers and published on change so the gate reacts immediately.
export class AppUpdatesService {
  public get requirement() {
    return this.#requirement;
  }

  #requirement: AppUpdateRequirement = {
    downloadUrl: MANUAL_DOWNLOAD_URL,
    required: false,
  };

  public start() {
    void this.#refresh();
    setInterval(() => {
      void this.#refresh();
    }, ms("1 hour"));
  }

  #applyConfig(config: {
    manualUpdateUrl: string;
    message?: string;
    minimumSupportedVersion: string;
    requiredUpdateUrl?: string;
  }) {
    const next: AppUpdateRequirement = {
      downloadUrl: config.requiredUpdateUrl ?? config.manualUpdateUrl,
      message: config.message,
      required: this.#isBelowMinimum(config.minimumSupportedVersion),
    };

    if (isEqual(next, this.#requirement)) {
      return;
    }

    this.#requirement = next;
    publisher.publish("updates.requirement", { requirement: next });
  }

  #isBelowMinimum(minimumSupportedVersion: string): boolean {
    // Never lock out dev/unpacked builds; app.getVersion() there is not a
    // shipped release and the updater is inactive.
    if (!app.isPackaged) {
      return false;
    }

    const current = app.getVersion();
    if (!semver.valid(current) || !semver.valid(minimumSupportedVersion)) {
      return false;
    }

    return semver.lt(current, minimumSupportedVersion);
  }

  async #refresh() {
    try {
      const config = await platformApiQueryClient.fetchQuery(
        platformApiRpcClient.appUpdates.get.queryOptions(),
      );
      this.#applyConfig(config);
    } catch (error) {
      // A failed fetch must not block the app; keep the last-known requirement.
      scopedLogger.warn("Failed to fetch app update config:", error);
    }
  }
}
