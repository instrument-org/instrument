import type { DownloadItem } from "electron";

import { perWorkspace } from "@/electron-main/lib/workspace-scope";
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

/**
 * The downloads of one workspace: its list, read from its store on first
 * use, and its transfers still running, for a cancel to reach. A transfer
 * keeps the one it started in, so one that finishes after a switch of
 * workspace lands in its own workspace's list.
 */
interface WorkspaceDownloads {
  list: BrowserDownload[] | null;
  running: Map<string, DownloadItem>;
  store: ReturnType<typeof getDownloadsStore>;
}

const held = perWorkspace(
  (): WorkspaceDownloads => ({
    list: null,
    running: new Map(),
    store: getDownloadsStore(),
  }),
);
let progressTimer: null | ReturnType<typeof setTimeout> = null;

// The list as last saved. A download that was running when the app last quit
// stopped with it, so it reads as failed.
function list(box = held()): BrowserDownload[] {
  box.list ??= box.store
    .get("downloads")
    .map((download) =>
      download.state === "progressing" || download.state === "interrupted"
        ? { ...download, state: "failed" as const }
        : download,
    );
  return box.list;
}

function changed(box = held()) {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  box.store.set("downloads", list(box));
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

function update(
  box: WorkspaceDownloads,
  id: string,
  patch: Partial<BrowserDownload>,
) {
  box.list = list(box).map((download) =>
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
  { asked = false }: { asked?: boolean } = {},
) {
  const box = held();
  const { running } = box;
  const id = crypto.randomUUID();
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
  const finished = list(box).filter((entry) => !running.has(entry.id));
  const dropped = new Set(finished.slice(KEEP - 1).map((entry) => entry.id));
  box.list = [download, ...list(box).filter((entry) => !dropped.has(entry.id))];
  changed(box);
  if (!savePath && !asked) {
    return;
  }
  running.set(id, item);
  item.on("updated", (_event, state) => {
    update(box, id, {
      path: item.getSavePath() || savePath,
      receivedBytes: item.getReceivedBytes(),
      state,
      totalBytes: item.getTotalBytes(),
    });
    progressed();
  });
  item.once("done", (_event, state) => {
    running.delete(id);
    update(box, id, {
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
    changed(box);
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
  held().running.get(id)?.cancel();
}

/** Takes a finished download off the list. The file stays where it is. */
export function removeDownload(id: string) {
  const box = held();
  if (box.running.has(id)) {
    return;
  }
  box.list = list(box).filter((download) => download.id !== id);
  changed(box);
}

/** Takes every finished download off the list, keeping the running ones. */
export function clearDownloads() {
  const box = held();
  box.list = list(box).filter((download) => box.running.has(download.id));
  changed(box);
}
