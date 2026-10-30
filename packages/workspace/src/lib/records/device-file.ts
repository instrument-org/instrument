import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { type DeviceId } from "./device-id";

/**
 * What a device says about itself to every other reader of the workspace,
 * in `.instrument/devices/<device>/device.json`, written by that device
 * alone: the name a person knows the computer by and its platform, so a
 * record's device id can be shown as "Jeremy's MacBook Pro".
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
});

export type DeviceFile = z.output<typeof DeviceFileSchema>;

/**
 * Writes this device's file when what it says has changed, so a launch
 * that changes nothing leaves the synced folder alone. Fields this build
 * does not write stay as the file had them.
 */
export async function writeDeviceFile({
  device,
  devicesDir,
  file,
}: {
  device: DeviceId;
  /** The workspace's devices folder (`workspaceLayout(…).devicesDir`). */
  devicesDir: string;
  file: DeviceFile;
}): Promise<void> {
  await updateJsonRecord(
    path.join(devicesDir, device, DEVICE_FILE_NAME),
    (current) =>
      current.name === file.name && current.platform === file.platform
        ? undefined
        : file,
  );
}

/**
 * The name a device's own file gives the computer, or none when the file is
 * not there yet (still syncing) or cannot be read.
 */
export async function readDeviceName({
  device,
  devicesDir,
}: {
  device: DeviceId;
  devicesDir: string;
}): Promise<string | undefined> {
  const read = await readJsonRecord(
    path.join(devicesDir, device, DEVICE_FILE_NAME),
  );
  if (read.kind !== "read") {
    return undefined;
  }
  const file = DeviceFileSchema.safeParse(read.record);
  return file.success ? file.data.name : undefined;
}

const run = promisify(execFile);

/**
 * The name a person gave the computer: macOS's Computer Name ("Jeremy's
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
