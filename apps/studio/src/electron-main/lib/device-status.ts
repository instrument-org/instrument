import {
  DEVICE_STATUS_HEARTBEAT_MS,
  type DeviceId,
  type DeviceStatus,
  isSameDeviceStatus,
  readDarkWake,
  writeDeviceStatusFile,
  writeDeviceStatusFileSync,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { app, powerMonitor } from "electron";

import { createScopedLogger } from "./electron-logger";
import { getWorkspaceFolder } from "./get-workspace-folder";

const log = createScopedLogger("deviceStatus");

let closeStatus: (() => void) | undefined;

/**
 * Keeps this computer's `status.json` in the workspace current
 * (`records/device-status-file.ts`) for as long as the app runs: written
 * awake at launch and on every heartbeat, and again whenever the system
 * sleeps or wakes, the screen locks or unlocks, or the power source changes.
 * A write that would change nothing but `writtenAt` is skipped, except on the
 * heartbeat, which is how a reader tells a running app from one that slept
 * before it could say so.
 *
 * The turn count and whether this is a dark wake are read again on the
 * heartbeat, at a wake, and with every write that is not going to sleep; a
 * turn starting or ending writes nothing of its own.
 */
export function startDeviceStatus({
  countBusy,
  deviceId,
}: {
  /** Turns running now, tasks included. */
  countBusy: () => Promise<number>;
  deviceId: DeviceId;
}): void {
  const devicesDir = workspaceLayout(getWorkspaceFolder()).devicesDir;
  let status: DeviceStatus = {
    app: app.getVersion(),
    busy: 0,
    locked: powerMonitor.getSystemIdleState(1) === "locked",
    power: powerMonitor.isOnBatteryPower() ? "battery" : "plugged-in",
    since: new Date(),
    state: "awake",
  };
  let written: DeviceStatus | undefined;
  // The file as the last write left it, which the quit's write goes over.
  let writtenFile: Awaited<ReturnType<typeof writeDeviceStatusFile>> = {};
  // One write at a time, so a slow read for one cannot land after the next.
  let queue = Promise.resolve();

  const update = (
    reason: string,
    change: Partial<DeviceStatus>,
    { always = false, reread = true } = {},
  ) => {
    queue = queue.then(async () => {
      const next: DeviceStatus = {
        ...status,
        ...change,
        power: powerMonitor.isOnBatteryPower() ? "battery" : "plugged-in",
      };
      if (change.state !== undefined && change.state !== status.state) {
        next.since = new Date();
      }
      if (reread) {
        const [busy, darkWake] = await Promise.all([
          countBusy().catch(() => status.busy),
          readDarkWake(),
        ]);
        next.busy = busy;
        next.darkWake = darkWake;
      }
      status = next;
      if (!always && written && isSameDeviceStatus(written, next)) {
        return;
      }
      try {
        writtenFile = await writeDeviceStatusFile({
          device: deviceId,
          devicesDir,
          status,
        });
        written = next;
      } catch (error) {
        log.warn(`Could not write the device status (${reason})`, error);
      }
    });
  };

  update("launch", {}, { always: true });

  const heartbeat = setInterval(() => {
    update(
      "heartbeat",
      { locked: powerMonitor.getSystemIdleState(1) === "locked" },
      { always: true },
    );
  }, DEVICE_STATUS_HEARTBEAT_MS);
  heartbeat.unref();

  // Best effort: the system may sleep before the write reaches the sync
  // engine, or before it is made at all, so nothing is read first.
  powerMonitor.on("suspend", () => {
    update("suspend", { state: "asleep" }, { reread: false });
  });
  powerMonitor.on("resume", () => {
    update("resume", {
      locked: powerMonitor.getSystemIdleState(1) === "locked",
      state: "awake",
    });
  });
  powerMonitor.on("lock-screen", () => {
    update("lock-screen", { locked: true });
  });
  powerMonitor.on("unlock-screen", () => {
    update("unlock-screen", { locked: false });
  });
  powerMonitor.on("on-ac", () => {
    update("on-ac", {});
  });
  powerMonitor.on("on-battery", () => {
    update("on-battery", {});
  });

  closeStatus = () => {
    clearInterval(heartbeat);
    const closed: DeviceStatus = {
      ...status,
      busy: 0,
      since: new Date(),
      state: "closed",
    };
    try {
      writeDeviceStatusFileSync({
        device: deviceId,
        devicesDir,
        status: closed,
        written: writtenFile,
      });
    } catch (error) {
      log.warn("Could not write the device status (quit)", error);
    }
  };
}

/**
 * Writes this computer's status as closed, synchronously, for the last step
 * of a quit before `app.exit`. Does nothing before the status has started.
 */
export function writeDeviceStatusClosed(): void {
  closeStatus?.();
  closeStatus = undefined;
}
