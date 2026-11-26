import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { watchDevices } from "../synced-store/watch-devices";
import { DEVICE_ID_PATTERN, type DeviceId } from "./device-id";

/**
 * What a device says about itself to every other reader of the workspace,
 * in `.instrument/devices/<device>/device.json`, written by that device
 * alone: the name a person knows the computer by and its platform, so a
 * record's device id can be shown as "Alex's MacBook Pro", and when it last
 * ran the app, to within a week, so a reader can set aside a computer no
 * longer in use.
 *
 * A device stands for a person. Devices whose files name no `person` are
 * all the workspace's owner, which is every device today. A service that
 * vouches for who is behind a device (an Instrument account, or one hosted
 * by anyone else) may add `person: { id, name, issuer }`, `issuer` naming
 * that service; this build writes none and carries one forward untouched.
 * A device id never spans two people, so a device that changes person
 * starts as a new device.
 */

export const DEVICE_FILE_NAME = "device.json";

const DeviceFileSchema = z.object({
  /** The computer's own name, as its system shows it. */
  name: z.string().min(1),
  /** `process.platform` of the computer the device runs on. */
  platform: z.string(),
  /**
   * When the app last ran on it, written again once a week while it does;
   * none from a build before this field, or from the phone.
   */
  seenAt: z.string().optional(),
});

export type DeviceFile = z.output<typeof DeviceFileSchema>;

/** How old `seenAt` gets before a running app writes it again. */
const SEEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Writes this device's file when what it says has changed or its `seenAt`
 * is a week old, so a launch that changes nothing leaves the synced folder
 * alone. Fields this build does not write stay as the file had them.
 */
export async function writeDeviceFile({
  device,
  devicesDir,
  file,
  now = new Date(),
}: {
  device: DeviceId;
  /** The workspace's devices folder (`workspaceLayout(…).devicesDir`). */
  devicesDir: string;
  file: Omit<DeviceFile, "seenAt">;
  now?: Date;
}): Promise<void> {
  await updateJsonRecord(
    path.join(devicesDir, device, DEVICE_FILE_NAME),
    (current) => {
      const seenAt =
        typeof current.seenAt === "string" ? Date.parse(current.seenAt) : NaN;
      return current.name === file.name &&
        current.platform === file.platform &&
        now.getTime() - seenAt < SEEN_REFRESH_MS
        ? undefined
        : { ...file, seenAt: now.toISOString() };
    },
  );
}

/**
 * What a device's own file says, or none when the file is not there yet
 * (still syncing) or cannot be read.
 */
export async function readDeviceFile({
  device,
  devicesDir,
}: {
  device: DeviceId;
  devicesDir: string;
}): Promise<DeviceFile | undefined> {
  const read = await readJsonRecord(
    path.join(devicesDir, device, DEVICE_FILE_NAME),
  );
  if (read.kind !== "read") {
    return undefined;
  }
  const file = DeviceFileSchema.safeParse(read.record);
  return file.success ? file.data : undefined;
}

/**
 * The name a device's own file gives the computer, or none when the file is
 * not there yet (still syncing) or cannot be read.
 */
export async function readDeviceName(place: {
  device: DeviceId;
  devicesDir: string;
}): Promise<string | undefined> {
  return (await readDeviceFile(place))?.name;
}

/** The platform the iPhone app writes into its `device.json`. */
const PHONE_PLATFORM = "ios";

const DEVICE_FOLDER = new RegExp(`^${DEVICE_ID_PATTERN}$`);

/**
 * Whether a phone has used the workspace: some device's `device.json` names
 * the platform the iPhone app writes. A computer writes `chat-list.json` and
 * `status.json` only for a phone to read, each sent whole to the sync engine
 * again on every write, so it writes neither while no phone has used the
 * workspace; nothing on a computer reads them.
 */
export async function workspaceHasPhone(devicesDir: string): Promise<boolean> {
  let folders: string[];
  try {
    folders = await fs.readdir(devicesDir);
  } catch {
    return false;
  }
  const platforms = await Promise.all(
    folders
      .filter((folder) => DEVICE_FOLDER.test(folder))
      .map(async (folder) => {
        const read = await readJsonRecord(
          path.join(devicesDir, folder, DEVICE_FILE_NAME),
        );
        return read.kind === "read" ? read.record.platform : undefined;
      }),
  );
  return platforms.includes(PHONE_PLATFORM);
}

/** How long a burst of watch events is gathered before a look. */
const PHONE_SETTLE_MS = 250;

/**
 * How often the devices folder is looked at again while no phone has used
 * the workspace, for a phone's `device.json` the watch did not hear of, as
 * when the watch could not start.
 */
const PHONE_LOOK_EVERY_MS = 5 * 60 * 1000;

/**
 * Answers true once a phone has used the workspace (`workspaceHasPhone`):
 * at once when one already has, and otherwise a moment after a phone's
 * `device.json` arrives, heard through a watch on the devices folder. Answers
 * false when `signal` aborts first. The watch and the look behind it end as
 * it answers, and never keep the process alive.
 */
export function whenWorkspaceHasPhone({
  devicesDir,
  platform = process.platform,
  settleMs = PHONE_SETTLE_MS,
  signal,
}: {
  devicesDir: string;
  platform?: NodeJS.Platform;
  settleMs?: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let answered = false;
    let settleTimer: NodeJS.Timeout | undefined;
    const answer = (found: boolean) => {
      if (answered) {
        return;
      }
      answered = true;
      clearTimeout(settleTimer);
      clearInterval(lookTimer);
      stopWatch();
      signal?.removeEventListener("abort", onAbort);
      resolve(found);
    };
    const look = async () => {
      if (!answered && (await workspaceHasPhone(devicesDir))) {
        answer(true);
      }
    };
    const onAbort = () => {
      answer(false);
    };
    const stopWatch = watchDevices({
      devicesDir,
      isOurs: (name) => name === DEVICE_FILE_NAME,
      onChange: () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => void look(), settleMs);
      },
      // A watch that fails leaves the look below to find the phone.
      onError: () => undefined,
      persistent: false,
      platform,
    });
    const lookTimer = setInterval(() => void look(), PHONE_LOOK_EVERY_MS);
    lookTimer.unref();
    signal?.addEventListener("abort", onAbort);
    void look();
  });
}

const run = promisify(execFile);

/**
 * The name a person gave the computer: macOS's Computer Name ("Alex's
 * MacBook Pro") where it can be read, the host name everywhere else.
 */
export async function readComputerName(
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform === "darwin") {
    try {
      const { stdout } = await run("scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const name = stdout.trim();
      if (name !== "") {
        return name;
      }
    } catch {
      // The host name below says which computer it is all the same.
    }
  }
  return os.hostname();
}
