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

import {
  clearUpdateReady,
  getUpdateReady,
  setUpdateReady,
} from "../stores/preferences";
import { logger } from "./electron-logger";
import { type AppUpdaterStatus } from "./update";

const scopedLogger = logger.scope("appUpdates");
const DEFAULT_REMINDER_HOURS = 24;

// The escalated "you've ignored a ready update too long" nudge. It never
// restarts on its own; the renderer surfaces a user-initiated restart CTA.
export interface AppUpdateReminder {
  show: boolean;
  version?: string;
}

// What the renderer needs to render the minimum-version block. `required` gates
// the full-screen `UpdateRequiredScreen`; `downloadUrl` is the server escape
// hatch the team can override per-incident.
export interface AppUpdateRequirement {
  downloadUrl: string;
  message?: string;
  required: boolean;
}

interface AppUpdatesConfig {
  manualUpdateUrl: string;
  message?: string;
  minimumSupportedVersion: string;
  reminderAfterHours: number;
  requiredUpdateUrl?: string;
}

// Fetches the server-controlled update config and derives two things: whether
// this build is below the minimum supported version (hard block), and whether a
// downloaded update has been ignored long enough to escalate to a reminder.
// Both are exposed synchronously for late RPC subscribers and published on
// change so the renderer reacts immediately.
export class AppUpdatesService {
  public get reminder() {
    return this.#reminder;
  }

  public get requirement() {
    return this.#requirement;
  }

  #config: AppUpdatesConfig | null = null;
  #reminder: AppUpdateReminder = { show: false };
  #requirement: AppUpdateRequirement = {
    downloadUrl: MANUAL_DOWNLOAD_URL,
    required: false,
  };

  public start() {
    this.#reconcileStaleReady();
    void this.#watchStatus();
    void this.#refresh();
    setInterval(() => {
      void this.#refresh();
    }, ms("1 hour"));
  }

  #applyReminder() {
    const ready = getUpdateReady();
    const thresholdHours =
      this.#config?.reminderAfterHours ?? DEFAULT_REMINDER_HOURS;
    const elapsed = ready ? Date.now() - ready.firstSeenAt : 0;
    const next: AppUpdateReminder =
      ready && elapsed >= thresholdHours * 60 * 60 * 1000
        ? { show: true, version: ready.version }
        : { show: false };

    if (isEqual(next, this.#reminder)) {
      return;
    }

    this.#reminder = next;
    publisher.publish("updates.reminder", { reminder: next });
  }

  #applyRequirement() {
    const config = this.#config;
    if (!config) {
      return;
    }

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

  #recompute() {
    this.#applyRequirement();
    this.#applyReminder();
  }

  // On launch, a persisted ready marker for a version we're already running
  // means the update was applied; drop it so no stale reminder appears.
  #reconcileStaleReady() {
    const ready = getUpdateReady();
    if (!ready?.version) {
      return;
    }

    const current = app.getVersion();
    if (
      semver.valid(current) &&
      semver.valid(ready.version) &&
      semver.gte(current, ready.version)
    ) {
      clearUpdateReady();
    }
  }

  async #refresh() {
    try {
      this.#config = await platformApiQueryClient.fetchQuery(
        platformApiRpcClient.appUpdates.get.queryOptions(),
      );
    } catch (error) {
      // A failed fetch must not block the app; keep the last-known config.
      scopedLogger.warn("Failed to fetch app update config:", error);
    }
    this.#recompute();
  }

  // A staged download survives background polls, so record when a version first
  // became ready and drop it once the app quits to install it.
  #trackReadyStatus(status: AppUpdaterStatus) {
    if (status.type === "downloaded") {
      const version = status.updateInfo?.version ?? "";
      const existing = getUpdateReady();
      if (!existing || existing.version !== version) {
        setUpdateReady({ firstSeenAt: Date.now(), version });
      }
    } else if (status.type === "installing") {
      clearUpdateReady();
    }
  }

  async #watchStatus() {
    for await (const { status } of publisher.subscribe("updates.status")) {
      this.#trackReadyStatus(status);
      this.#recompute();
    }
  }
}
