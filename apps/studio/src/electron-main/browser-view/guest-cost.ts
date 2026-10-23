import type { BrowserTargetId } from "@instrument-org/workspace/electron";

import { app } from "electron";

import type { BrowserEntry } from "./entry";

/**
 * How old a reading of the process metrics may be before it is taken again.
 * Electron averages each process's CPU since the previous reading, so readings
 * taken moments apart would say little; this keeps every one at least this long.
 */
const READING_FRESH_MS = 5000;

/** One process's memory in bytes and CPU in percent of one core. */
type ProcessCost = { cpuPercent: number; memoryBytes: number };

let reading: { at: number; byPid: Map<number, ProcessCost> } | undefined;

/** Every process's cost, by its OS pid, read again once the last reading is stale. */
function costsByPid(): Map<number, ProcessCost> {
  const now = Date.now();
  if (!reading || now - reading.at >= READING_FRESH_MS) {
    reading = {
      at: now,
      byPid: new Map(
        app.getAppMetrics().map((metric) => [
          metric.pid,
          {
            cpuPercent: metric.cpu.percentCPUUsage,
            // Electron reports the working set in kilobytes.
            memoryBytes: metric.memory.workingSetSize * 1024,
          },
        ]),
      ),
    };
  }
  return reading.byPid;
}

/**
 * What a guest's renderer process costs, matched to the process metrics by
 * its OS pid, which works the same on every platform. Chromium can draw
 * several pages of one site in one process, so the guests sharing it are
 * named: the cost is theirs together.
 */
export function guestCost(
  entries: Map<BrowserTargetId, BrowserEntry>,
  targetId: BrowserTargetId,
): null | {
  cpuPercent: number;
  memoryBytes: number;
  sharedWith: BrowserTargetId[];
} {
  const pidOf = (entry: BrowserEntry | undefined) => {
    const guest = entry?.webContents;
    return guest && !guest.isDestroyed() ? guest.getOSProcessId() : undefined;
  };
  const pid = pidOf(entries.get(targetId));
  if (pid === undefined) {
    return null;
  }
  const cost = costsByPid().get(pid);
  if (!cost) {
    return null;
  }
  const sharedWith = [...entries.values()]
    .filter((entry) => entry.targetId !== targetId && pidOf(entry) === pid)
    .map((entry) => entry.targetId);
  return { ...cost, sharedWith };
}
