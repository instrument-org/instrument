import type { Protocol } from "devtools-protocol";
import type { DownloadItem, Session, WebContents } from "electron";

import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { BrowserEntry } from "./entry";

// Sessions that already carry the will-download listener. Every task guest
// opens the one workspace profile, so they all share a Session, and a listener
// added per guest would stack: each copy runs on every download, and any copy
// whose own target has no authorized path cancels the item for all of them.
const wiredSessions = new WeakSet<Session>();

export function applyDownloadBehavior(
  entry: BrowserEntry,
  params: unknown,
): Record<string, never> {
  const p = (params ?? {}) as Protocol.Browser.SetDownloadBehaviorRequest;
  const downloadPath = p.downloadPath ?? null;
  const behavior = p.behavior;
  entry.authorizedDownloadPath =
    (behavior === "allow" || behavior === "allowAndName") && downloadPath
      ? downloadPath
      : null;
  return {};
}

// Register the will-download handler for this session, once. A download is
// attributed to the guest that started it, and routed by that guest's entry.
// With a path the agent authorized via setDownloadBehavior, the file lands
// there under the GUID as filename (what agent-browser's `download` command
// expects from "allowAndName"), with a fresh GUID when no downloadWillBegin
// captured one. Without one, the download is the person's own, from a click in
// the browser panel, and lands in their Downloads folder under its own name.
// Only a download from a guest no entry owns is canceled.
export function attachDownloadHandler({
  entries,
  session,
}: {
  entries: Map<BrowserTargetId, BrowserEntry>;
  session: Session;
}) {
  if (wiredSessions.has(session)) {
    return;
  }
  wiredSessions.add(session);

  session.on("will-download", (_event, item, webContents) => {
    const entry = findEntryByWebContents(entries, webContents);
    if (!entry) {
      item.cancel();
      return;
    }
    if (entry.authorizedDownloadPath) {
      saveForAgent(entries, entry, item, entry.authorizedDownloadPath);
    } else {
      saveForPerson(entry, item);
    }
  });
}

// Capture the GUID from Page.downloadWillBegin so will-download can
// save with the GUID filename that agent-browser expects to find.
export function captureDownloadWillBeginGuid(
  entry: BrowserEntry,
  params: unknown,
) {
  const p = params as Protocol.Browser.DownloadWillBeginEvent;
  if (p.guid && p.url) {
    entry.pendingDownloadGuids.set(p.url, p.guid);
  }
}

// `findAvailableName`'s convention, done synchronously: the save path has to
// be set before the will-download handler returns.
function availableFilename(dir: string, filename: string): string {
  const taken = (candidate: string) => fs.existsSync(path.join(dir, candidate));
  if (!taken(filename)) {
    return filename;
  }
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let suffix = 2;
  while (taken(`${stem}-${suffix}${ext}`)) {
    suffix += 1;
  }
  return `${stem}-${suffix}${ext}`;
}

// The folder as the toast shows it, with the home directory collapsed the
// way the app shows every path of the person's.
function displayFolder(dir: string): string {
  const home = app.getPath("home");
  return dir === home || dir.startsWith(home + path.sep)
    ? `~${dir.slice(home.length)}`
    : dir;
}

// By the guest's identity rather than a captured target id: the entry map is
// keyed by target, and the download event names only the WebContents it came
// from. Matched on id, which is stable for the life of a live guest.
function findEntryByWebContents(
  entries: Map<BrowserTargetId, BrowserEntry>,
  webContents: WebContents,
): BrowserEntry | undefined {
  for (const entry of entries.values()) {
    if (entry.webContents?.id === webContents.id) {
      return entry;
    }
  }
  return undefined;
}

// The person's own Downloads folder, proved writable before it is chosen.
// Writing there is the first thing that can fail: macOS asks once before an
// app may touch Downloads and remembers a refusal, and a platform can have no
// Downloads folder at all. Proving it by writing and removing a file is also
// what raises the system's question at the moment it makes sense, on the
// click. The workspace's own downloads folder stands in when Downloads does
// not take a file; null when nothing does.
function personDownloadsDir(): null | string {
  const candidates = [
    () => app.getPath("downloads"),
    () => path.join(getWorkspaceFolder(), "downloads"),
  ];
  for (const candidate of candidates) {
    try {
      const dir = candidate();
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.instrument-write-probe-${process.pid}`);
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // On to the next.
    }
  }
  return null;
}

function saveForAgent(
  entries: Map<BrowserTargetId, BrowserEntry>,
  entry: BrowserEntry,
  item: DownloadItem,
  authorizedDownloadPath: string,
) {
  const { targetId } = entry;

  const guid =
    entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
  entry.pendingDownloadGuids.delete(item.getURL());
  item.setSavePath(`${authorizedDownloadPath}/${guid}`);

  // Synthesize Page.downloadWillBegin so agent-browser's download command
  // can capture the GUID and start waiting for completion.
  const willBegin: Protocol.Browser.DownloadWillBeginEvent = {
    frameId: targetId,
    guid,
    suggestedFilename: item.getFilename(),
    url: item.getURL(),
  };
  for (const listener of entry.eventListeners) {
    listener("Page.downloadWillBegin", willBegin);
  }

  item.once("done", (_doneEvent, state) => {
    const currentEntry = entries.get(targetId);
    if (!currentEntry) {
      return;
    }
    // The authorization was for this one transfer: agent-browser sends a
    // fresh setDownloadBehavior ahead of every `download` and never rescinds
    // one, so left in place it would claim the person's next click on this
    // guest too, saving it under a GUID where they cannot find it.
    currentEntry.authorizedDownloadPath = null;
    // Synthesize Page.downloadProgress so agent-browser resolves or errors.
    const progress: Protocol.Browser.DownloadProgressEvent = {
      guid,
      receivedBytes: item.getReceivedBytes(),
      state: state === "completed" ? "completed" : "canceled",
      totalBytes: item.getTotalBytes(),
    };
    for (const listener of currentEntry.eventListeners) {
      listener("Page.downloadProgress", progress);
    }
  });
}

// Where a download from any other browser goes, without a chooser: the
// person's Downloads folder, and the renderer is told where it landed so the
// window can say so. A name already taken gets the `-2`, `-3` suffix the rest
// of the app gives a copy, rather than overwriting, which is what an explicit
// save path otherwise does.
function saveForPerson(entry: BrowserEntry, item: DownloadItem) {
  const filename = item.getFilename();
  const report = (
    completed: boolean,
    saved: null | { dir: string; savePath: string },
  ) => {
    publisher.publish("browser.download-finished", {
      completed,
      filename: saved ? path.basename(saved.savePath) : filename,
      folder: saved ? displayFolder(saved.dir) : null,
      host: entry.host,
      path: saved?.savePath ?? null,
      targetId: entry.targetId,
    });
  };

  const dir = personDownloadsDir();
  if (!dir) {
    item.cancel();
    report(false, null);
    return;
  }
  const savePath = path.join(dir, availableFilename(dir, filename));
  item.setSavePath(savePath);

  item.once("done", (_doneEvent, state) => {
    report(state === "completed", { dir, savePath });
  });
}
