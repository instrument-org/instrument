import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { type MemoryLevel } from "@instrument-org/workspace/electron";
import { app } from "electron";

const run = promisify(execFile);

/** How long `sysctl` may take before the reading counts as failed. */
const SYSCTL_TIMEOUT_MS = 2000;

/**
 * Available memory under which Windows and Linux count as low, and as
 * critical: Chromium's thresholds for Windows, set where paging begins.
 */
export const LOW_AVAILABLE_BYTES = 1000 * 1024 * 1024;
export const CRITICAL_AVAILABLE_BYTES = 400 * 1024 * 1024;

/**
 * How short the system is of memory, by its own account.
 *
 * macOS: the kernel's pressure level (`kern.memorystatus_vm_pressure_level`),
 * which Activity Monitor's Memory Pressure graph draws and Chromium reads for
 * its own tab discards; free memory there says little, since macOS fills it
 * with cache and compresses before it pages. 2 is the warning level, 4 the
 * critical one.
 *
 * Windows and Linux: physical memory available without paging, which Node
 * reads as the system's own figure (`ullAvailPhys`, `MemAvailable`, or what
 * a container's limit leaves when that is less), against
 * Chromium's Windows thresholds. A fixed amount rather than a share of all
 * memory, since a share low enough to matter on 8 GB is several gigabytes
 * free on 64.
 *
 * A reading that fails rejects, and the window browser keeps the last level.
 *
 * In a development build, `INSTRUMENT_MEMORY_LEVEL_FILE` names a file whose
 * text (`normal`, `low` or `critical`) is read in place of the system's, so a
 * run can drive the level.
 */
export async function readMemoryLevel(): Promise<MemoryLevel> {
  const pinned = process.env.INSTRUMENT_MEMORY_LEVEL_FILE;
  if (pinned && !app.isPackaged) {
    const text = await readFile(pinned, "utf8").catch(() => "");
    return memoryLevelOf(text.trim());
  }
  if (process.platform === "darwin") {
    const { stdout } = await run(
      "/usr/sbin/sysctl",
      ["-n", "kern.memorystatus_vm_pressure_level"],
      { timeout: SYSCTL_TIMEOUT_MS },
    );
    return macMemoryLevel(Number(stdout.trim()));
  }
  return availableMemoryLevel(process.availableMemory());
}

/** The level a macOS pressure reading names: 2 is the kernel's warning, 4 critical. */
export function macMemoryLevel(level: number): MemoryLevel {
  if (level === 4) {
    return "critical";
  }
  return level === 2 ? "low" : "normal";
}

/** The level an amount of available memory comes to; none read is normal. */
export function availableMemoryLevel(bytes: number): MemoryLevel {
  if (bytes <= 0) {
    return "normal";
  }
  if (bytes < CRITICAL_AVAILABLE_BYTES) {
    return "critical";
  }
  return bytes < LOW_AVAILABLE_BYTES ? "low" : "normal";
}

function memoryLevelOf(text: string): MemoryLevel {
  return text === "low" || text === "critical" ? text : "normal";
}
