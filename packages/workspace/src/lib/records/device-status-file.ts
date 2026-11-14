import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { type JsonRecord, updateJsonRecord } from "../json-record-file";
import { type DeviceId } from "./device-id";

/**
 * What a computer says about whether it can answer right now, in
 * `.instrument/devices/<device>/status.json` beside its `device.json`,
 * written by that computer alone while the app runs: awake, asleep or
 * closed, since when, and what would make a reply slow (a dark wake, a
 * battery, a locked screen, turns already running). A phone reads it to show
 * each computer's state on its chat list and to let the person pick which one
 * answers a new chat; the phone writes none.
 *
 * A computer going to sleep writes `asleep` as it goes, which may not reach
 * the sync engine before it sleeps, so a reader also takes a `writtenAt`
 * older than a few heartbeats as asleep.
 */
export const DEVICE_STATUS_FILE_NAME = "status.json";

/** The file's shape, which a reader checks before it reads the rest. */
const DEVICE_STATUS_FORMAT = 1;

/** How often a running app writes the file, whatever changed. */
export const DEVICE_STATUS_HEARTBEAT_MS = 5 * 60 * 1000;

export type DeviceStatus = {
  /** The app's version. */
  app: string;
  /** Turns running now on this computer, its chats' tasks included. */
  busy: number;
  /**
   * On macOS only: whether the system was in a dark wake (a maintenance
   * wake with no display) when this was written, when that could be read.
   */
  darkWake?: boolean;
  locked: boolean;
  power: "battery" | "plugged-in";
  /** When `state` last changed. */
  since: Date;
  state: "asleep" | "awake" | "closed";
};

/** The file's contents for a status written at `writtenAt`. */
export function deviceStatusFile(
  status: DeviceStatus,
  writtenAt: Date,
): JsonRecord {
  return {
    format: DEVICE_STATUS_FORMAT,
    writtenAt: writtenAt.toISOString(),
    state: status.state,
    since: status.since.toISOString(),
    // Set to nothing when unknown, so a value an earlier write left is
    // dropped rather than carried forward.
    darkWake: status.darkWake,
    power: status.power,
    locked: status.locked,
    busy: status.busy,
    app: status.app,
  };
}

/** Whether two statuses would write the same file but for `writtenAt`. */
export function isSameDeviceStatus(a: DeviceStatus, b: DeviceStatus): boolean {
  return (
    a.app === b.app &&
    a.busy === b.busy &&
    a.darkWake === b.darkWake &&
    a.locked === b.locked &&
    a.power === b.power &&
    a.since.getTime() === b.since.getTime() &&
    a.state === b.state
  );
}

function statusFilePath(devicesDir: string, device: DeviceId): string {
  return path.join(devicesDir, device, DEVICE_STATUS_FILE_NAME);
}

/**
 * Writes this device's status file. Answers with the file as it stands
 * afterward, for `writeDeviceStatusFileSync` to write over.
 */
export function writeDeviceStatusFile({
  device,
  devicesDir,
  status,
  writtenAt = new Date(),
}: {
  device: DeviceId;
  /** The workspace's devices folder (`workspaceLayout(…).devicesDir`). */
  devicesDir: string;
  status: DeviceStatus;
  writtenAt?: Date;
}): Promise<JsonRecord> {
  return updateJsonRecord(statusFilePath(devicesDir, device), () =>
    deviceStatusFile(status, writtenAt),
  );
}

/**
 * `writeDeviceStatusFile` for the last moment of a quit, which ends in
 * `app.exit` and waits on nothing. Atomic like it, and reads nothing, since
 * a synced file may not be on disk to read: it writes over `written`, the
 * file as the last write left it, so fields a newer build wrote are kept.
 */
export function writeDeviceStatusFileSync({
  device,
  devicesDir,
  status,
  written = {},
  writtenAt = new Date(),
}: {
  device: DeviceId;
  devicesDir: string;
  status: DeviceStatus;
  written?: JsonRecord;
  writtenAt?: Date;
}): void {
  const file = statusFilePath(devicesDir, device);
  const next = Object.fromEntries(
    Object.entries({
      ...written,
      ...deviceStatusFile(status, writtenAt),
    }).filter(([, value]) => value !== undefined),
  );
  const temporary = `${file}.${process.pid.toString()}.closing.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * The root power domain's "System Capabilities" in `ioreg -n IOPMrootDomain`
 * output, the bits `IOPM.h` names `kIOPMSystemCapability*`, or none when the
 * output does not have it.
 */
export function parseSystemCapabilities(ioreg: string): number | undefined {
  const match = /"System Capabilities"\s*=\s*(\d+)/.exec(ioreg);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** `kIOPMSystemCapabilityGraphics`: the display is up. */
const GRAPHICS_CAPABILITY = 0x2;

/**
 * Whether the system is in a dark wake: running without graphics. A full
 * wake reads 15 (CPU, graphics, audio, network) and stays 15 while only the
 * display sleeps; a dark wake reads 9 (CPU and network).
 */
export function isDarkWake(capabilities: number): boolean {
  return (capabilities & GRAPHICS_CAPABILITY) === 0;
}

const run = promisify(execFile);

/**
 * Whether this Mac is in a dark wake now, read from `ioreg`, since macOS has
 * no API that says so; none off macOS or when it cannot be read.
 */
export async function readDarkWake(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean | undefined> {
  if (platform !== "darwin") {
    return undefined;
  }
  try {
    const { stdout } = await run(
      "ioreg",
      ["-n", "IOPMrootDomain", "-r", "-d1"],
      { encoding: "utf8", timeout: 5000 },
    );
    const capabilities = parseSystemCapabilities(stdout);
    return capabilities === undefined ? undefined : isDarkWake(capabilities);
  } catch {
    return undefined;
  }
}
