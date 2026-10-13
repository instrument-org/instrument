import {
  type WindowsDriveKind,
  windowsDriveName,
} from "@/shared/os-conventions";
import { z } from "zod";

import { powerShellArgs, runHelper } from "./file-open-target/helper-process";

/** `System.IO.DriveType`, as the kind of disk each number stands for. */
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
 * The drives the script below reports, each named the way File Explorer
 * lists it ("Local Disk (C:)"), by its root (`C:\`).
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

/**
 * Every drive letter, in `Win32_LogicalDisk`'s shape, read from .NET's
 * DriveInfo: no WMI service to wait on and no module to load first. A
 * network drive's label is never read, since that asks its server, and a
 * server that is gone holds the answer up; a mapped one is named by the
 * share the registry keeps for it. Nor is a drive with no disk in it, or A
 * and B, the floppy letters, which can answer slowly with nothing there.
 */
const SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
ConvertTo-Json -Compress @(foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
  $type = [int]$drive.DriveType
  $label = $null
  $share = $null
  if ($type -eq 4) {
    $share = (Get-ItemProperty -LiteralPath ('HKCU:\Network\' + $drive.Name[0])).RemotePath
  } elseif ($drive.Name -notmatch '^[AB]:') {
    try { if ($drive.IsReady) { $label = $drive.VolumeLabel } } catch {}
  }
  [pscustomobject]@{ DeviceID = $drive.Name.Substring(0, 2); DriveType = $type; ProviderName = $share; VolumeName = $label }
})`;

// The Files sidebar asks for its places whenever the window takes focus, and
// a drive's label rarely changes, so one PowerShell start answers for a while.
const FRESH_FOR_MS = 30_000;

// How long an ask waits on Windows for a drive it has no name for yet. The
// sidebar is drawn when the ask answers, and a PowerShell start can take a
// second or more.
const WAIT_FOR_NAMES_MS = 500;

// The last answer Windows gave, kept until it gives another.
let known: Record<string, string> = {};
// The drive roots there were when Windows was last asked, and when.
let askedFor: string | undefined;
let askedAt = 0;
let asking: Promise<void> | undefined;

/**
 * What File Explorer calls each drive on this computer, by its root, for the
 * drives at `roots`. Answered at once from what Windows last said; when a
 * drive there has no name yet, Windows is asked and the answer waited on for
 * a moment, and a drive still unnamed after it goes by its letter until a
 * later ask. Windows is asked again when the drives there change and, behind
 * the last answer, when that answer is a little old. An ask that fails keeps
 * the last answer.
 */
export async function windowsDriveNames(
  roots: readonly string[],
): Promise<Record<string, string>> {
  const present = roots.toSorted().join("|");
  if (
    !asking &&
    (present !== askedFor || Date.now() - askedAt >= FRESH_FOR_MS)
  ) {
    askedFor = present;
    askedAt = Date.now();
    asking = askWindows()
      .then((fresh) => {
        if (fresh) {
          known = fresh;
        }
      })
      .finally(() => {
        asking = undefined;
      });
  }
  if (asking && roots.some((root) => known[root] === undefined)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      asking,
      new Promise((resolve) => {
        timer = setTimeout(resolve, WAIT_FOR_NAMES_MS);
      }),
    ]);
    clearTimeout(timer);
  }
  return known;
}

/** Every drive's name as Windows has it now, or nothing when it cannot say. */
async function askWindows(): Promise<Record<string, string> | undefined> {
  try {
    const stdout = await runHelper({
      args: powerShellArgs(SCRIPT),
      file: "powershell",
    });
    const trimmed = stdout.trim();
    return trimmed ? driveNamesOf(trimmed) : undefined;
  } catch {
    return undefined;
  }
}
