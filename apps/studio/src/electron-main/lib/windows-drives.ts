import {
  type WindowsDriveKind,
  windowsDriveName,
} from "@/shared/os-conventions";
import { z } from "zod";

import { powerShellArgs, runHelper } from "./file-open-target/helper-process";

/** `Win32_LogicalDisk.DriveType`, as the kind of disk each number stands for. */
const DRIVE_KINDS: Record<number, WindowsDriveKind | undefined> = {
  2: "removable",
  3: "fixed",
  4: "network",
  5: "optical",
  6: "ram",
};

const LogicalDiskSchema = z.object({
  DeviceID: z.string(),
  DriveType: z.number().nullish(),
  ProviderName: z.string().nullish(),
  VolumeName: z.string().nullish(),
});

/**
 * The drives `Get-CimInstance Win32_LogicalDisk` reports, each named the way
 * File Explorer lists it ("Local Disk (C:)"), by its root (`C:\`).
 */
export function driveNamesOf(json: string): Record<string, string> {
  const parsed: unknown = JSON.parse(json);
  // ConvertTo-Json writes a lone disk as an object rather than a list of one.
  const disks = LogicalDiskSchema.array().parse(
    Array.isArray(parsed) ? parsed : [parsed],
  );
  return Object.fromEntries(
    disks.flatMap((disk) => {
      const letter = disk.DeviceID.toUpperCase();
      if (!/^[A-Z]:$/.test(letter)) {
        return [];
      }
      const name = windowsDriveName({
        kind: DRIVE_KINDS[disk.DriveType ?? 0] ?? "unknown",
        label: disk.VolumeName ?? "",
        letter,
        ...(disk.ProviderName ? { share: disk.ProviderName } : {}),
      });
      return [[`${letter}\\`, name]];
    }),
  );
}

const SCRIPT =
  "Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID, DriveType, ProviderName, VolumeName | ConvertTo-Json -Compress";

// The Files sidebar asks for its places whenever the window takes focus, and
// a drive's label rarely changes, so one PowerShell start answers for a while.
const FRESH_FOR_MS = 30_000;

let names: Promise<Record<string, string>> | undefined;
let askedAt = 0;

/**
 * What File Explorer calls each drive on this computer, by its root. The first
 * ask waits for Windows; after that the last answer is given at once, and one
 * older than a little while is asked for again behind it, so a drive plugged
 * in or renamed is named from a later ask. Empty when Windows cannot be asked.
 */
export function windowsDriveNames(): Promise<Record<string, string>> {
  const now = Date.now();
  if (names && now - askedAt < FRESH_FOR_MS) {
    return names;
  }
  askedAt = now;
  const asking = askWindows();
  if (!names) {
    names = asking;
    return asking;
  }
  void asking.then((fresh) => {
    names = Promise.resolve(fresh);
  });
  return names;
}

async function askWindows(): Promise<Record<string, string>> {
  try {
    const stdout = await runHelper({
      args: powerShellArgs(SCRIPT),
      file: "powershell",
    });
    const trimmed = stdout.trim();
    return trimmed ? driveNamesOf(trimmed) : {};
  } catch {
    return {};
  }
}
