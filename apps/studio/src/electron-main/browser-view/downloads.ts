import type { Protocol } from "devtools-protocol";
import type { Session } from "electron";

import { type BrowserTargetId } from "@instrument-org/workspace/electron";

import type { BrowserEntry } from "./entry";

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

// Register a single will-download handler for this session. If the agent
// has authorized a download path via setDownloadBehavior, route the file
// there using the GUID as filename (matching agent-browser's "allowAndName"
// expectation), falling back to a freshly-generated GUID when no
// downloadWillBegin captured one.
export function attachDownloadHandler({
  entries,
  session,
  targetId,
}: {
  entries: Map<BrowserTargetId, BrowserEntry>;
  session: Session;
  targetId: BrowserTargetId;
}) {
  session.on("will-download", (_event, item) => {
    const entry = entries.get(targetId);
    if (!entry?.authorizedDownloadPath) {
      item.cancel();
      return;
    }

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
