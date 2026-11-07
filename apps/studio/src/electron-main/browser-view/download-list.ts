import type { DownloadItem } from "electron";

import { publisher } from "@/electron-main/rpc/publisher";
import {
  type BrowserDownload,
  getDownloadsStore,
} from "@/electron-main/stores/workspace/downloads";
import fs from "node:fs";

// How many finished downloads the list keeps before dropping the oldest.
const KEEP = 100;
// How often a download's progress reaches the window at most. Chromium reports
// every chunk it writes.
const PROGRESS_INTERVAL_MS = 250;

let downloads: BrowserDownload[] | null = null;
// The transfers still running, for a cancel to reach.
const running = new Map<string, DownloadItem>();

/**
 * The page a download started from and, when a press there started it, where
 * in the page: what the window draws the download leaving from. Kept for this
 * run alone, since it only means something the moment the download begins.
 */
export interface DownloadOrigin {
  targetId: string;
  x?: number;
  y?: number;
}

const origins = new Map<string, DownloadOrigin>();
let progressTimer: null | ReturnType<typeof setTimeout> = null;

// The list as last saved. A download that was running when the app last quit
// stopped with it, so it reads as failed.
function list(): BrowserDownload[] {
  downloads ??= getDownloadsStore()
    .get("downloads")
    .map((download) =>
      download.state === "progressing" || download.state === "interrupted"
        ? { ...download, state: "failed" as const }
        : download,
    );
  return downloads;
}

function changed() {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  getDownloadsStore().set("downloads", list());
  publisher.publish("browser.downloads-changed", null);
}

// Progress is said to the window but not saved: a relaunch reads a running
// download as failed whatever its count was.
function progressed() {
  progressTimer ??= setTimeout(() => {
    progressTimer = null;
    publisher.publish("browser.downloads-changed", null);
  }, PROGRESS_INTERVAL_MS);
}

function update(id: string, patch: Partial<BrowserDownload>) {
  downloads = list().map((download) =>
    download.id === id ? { ...download, ...patch } : download,
  );
}

/**
 * Puts a person's download on the list and follows it to the end.
 * `savePath` is where the file is being written, or null for a download with
 * none yet: one the system is asking the person where to put (`asked`),
 * whose path the list reads off the transfer once they have picked, and
 * otherwise one that failed before it began because no folder took it.
 */
export function trackDownload(
  item: DownloadItem,
  savePath: null | string,
  {
    asked = false,
    origin = null,
  }: { asked?: boolean; origin?: DownloadOrigin | null } = {},
) {
  const id = crypto.randomUUID();
  if (origin) {
    origins.set(id, origin);
  }
  const download: BrowserDownload = {
    filename: item.getFilename(),
    id,
    path: savePath,
    receivedBytes: 0,
    startedAt: Date.now(),
    state: savePath || asked ? "progressing" : "failed",
    totalBytes: item.getTotalBytes(),
    url: item.getURL(),
  };
  const finished = list().filter((entry) => !running.has(entry.id));
  const dropped = new Set(finished.slice(KEEP - 1).map((entry) => entry.id));
  downloads = [download, ...list().filter((entry) => !dropped.has(entry.id))];
  changed();
  if (!savePath && !asked) {
    return;
  }
  running.set(id, item);
  item.on("updated", (_event, state) => {
    update(id, {
      path: item.getSavePath() || savePath,
      receivedBytes: item.getReceivedBytes(),
      state,
      totalBytes: item.getTotalBytes(),
    });
    progressed();
  });
  item.once("done", (_event, state) => {
    running.delete(id);
    update(id, {
      path: item.getSavePath() || savePath,
      receivedBytes: item.getReceivedBytes(),
      state:
        state === "completed"
          ? "completed"
          : state === "cancelled"
            ? "canceled"
            : "failed",
      totalBytes: item.getTotalBytes(),
    });
    changed();
  });
}

/**
 * The list, newest first, each finished download saying whether its file is
 * still where it was saved.
 */
export function listDownloads(): (BrowserDownload & {
  exists: boolean;
  origin?: DownloadOrigin;
})[] {
  return list().map((download) => ({
    ...download,
    ...(origins.has(download.id) ? { origin: origins.get(download.id) } : {}),
    exists:
      download.state === "completed" &&
      download.path !== null &&
      fs.existsSync(download.path),
  }));
}

/** Stops a running download; its `done` takes it off the running list. */
export function cancelDownload(id: string) {
  running.get(id)?.cancel();
}

/** Takes a finished download off the list. The file stays where it is. */
export function removeDownload(id: string) {
  if (running.has(id)) {
    return;
  }
  origins.delete(id);
  downloads = list().filter((download) => download.id !== id);
  changed();
}

/**
 * Starts a download that stopped or failed again from its address, the new
 * download taking its row's place, as a browser's Retry does. `start` begins
 * the download and says whether it could.
 */
export function retryDownload(id: string, start: (url: string) => boolean) {
  const download = list().find((each) => each.id === id);
  if (
    download === undefined ||
    running.has(id) ||
    (download.state !== "canceled" && download.state !== "failed")
  ) {
    return;
  }
  if (start(download.url)) {
    removeDownload(id);
  }
}

/** Takes every finished download off the list, keeping the running ones. */
export function clearDownloads() {
  for (const id of origins.keys()) {
    if (!running.has(id)) {
      origins.delete(id);
    }
  }
  downloads = list().filter((download) => running.has(download.id));
  changed();
}
