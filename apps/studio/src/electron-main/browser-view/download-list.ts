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
 * Puts a person's download on the list and follows it to the end. `savePath`
 * is null when no folder would take the file, which is a download that failed
 * before it began.
 */
export function trackDownload(item: DownloadItem, savePath: null | string) {
  const id = crypto.randomUUID();
  const download: BrowserDownload = {
    filename: item.getFilename(),
    id,
    path: savePath,
    receivedBytes: 0,
    startedAt: Date.now(),
    state: savePath ? "progressing" : "failed",
    totalBytes: item.getTotalBytes(),
    url: item.getURL(),
  };
  const finished = list().filter((entry) => !running.has(entry.id));
  const dropped = new Set(finished.slice(KEEP - 1).map((entry) => entry.id));
  downloads = [download, ...list().filter((entry) => !dropped.has(entry.id))];
  changed();
  if (!savePath) {
    return;
  }
  running.set(id, item);
  item.on("updated", (_event, state) => {
    update(id, {
      receivedBytes: item.getReceivedBytes(),
      state,
      totalBytes: item.getTotalBytes(),
    });
    progressed();
  });
  item.once("done", (_event, state) => {
    running.delete(id);
    update(id, {
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
export function listDownloads(): (BrowserDownload & { exists: boolean })[] {
  return list().map((download) => ({
    ...download,
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
  downloads = list().filter((download) => download.id !== id);
  changed();
}

/** Takes every finished download off the list, keeping the running ones. */
export function clearDownloads() {
  downloads = list().filter((download) => running.has(download.id));
  changed();
}
