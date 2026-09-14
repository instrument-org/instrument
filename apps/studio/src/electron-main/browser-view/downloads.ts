import type { Protocol } from "devtools-protocol";
import type { Session, WebContents } from "electron";

import { type BrowserTargetId } from "@instrument-org/workspace/electron";

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
// attributed to the guest that started it, and routed by that guest's entry:
// if the agent has authorized a download path there via setDownloadBehavior,
// the file lands in it under the GUID as filename (matching agent-browser's
// "allowAndName" expectation), falling back to a freshly-generated GUID when
// no downloadWillBegin captured one. A download from any other guest, or from
// one whose entry is gone, is canceled.
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
    if (!entry?.authorizedDownloadPath) {
      item.cancel();
      return;
    }
    const { targetId } = entry;

    const guid =
      entry.pendingDownloadGuids.get(item.getURL()) ?? crypto.randomUUID();
    entry.pendingDownloadGuids.delete(item.getURL());
    item.setSavePath(`${entry.authorizedDownloadPath}/${guid}`);

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
