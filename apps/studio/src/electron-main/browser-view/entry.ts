import type { WebContentsView } from "electron";

import {
  type AbsolutePath,
  type BrowserTargetId,
  type ProjectSubdomain,
  type StoreId,
} from "@instrument-org/workspace/electron";
import { noop } from "radashi";

import { log } from "./log";

export interface BrowserEntry {
  authorizedDownloadPath: null | string;
  // Listeners notified once when the entry is removed from the manager (for
  // any reason: explicit close, detach, renderer crash). Drained as part of
  // the disposer chain so they never fire more than once. Used to surface
  // "view destroyed" to higher layers (e.g. the projectBrowser machine).
  destructionListeners: Set<() => void>;
  detachListeners: Set<() => void>;
  // Disposers run once when the entry is torn down (either via explicit close
  // or detach). Each disposer must be idempotent-safe; it will be called at
  // most once because the set is cleared after draining.
  disposers: Set<() => void>;
  eventListeners: Set<(method: string, params: unknown) => void>;
  // Chromium profile partition directory; threaded through so callers like
  // BrowserConfig.getTargetMeta can correlate the target back to its session
  // dir without re-deriving it.
  partitionDir: AbsolutePath;
  // Maps download URL -> GUID from Page.downloadWillBegin, consumed by will-download.
  pendingDownloadGuids: Map<string, string>;
  screencastInterval: null | ReturnType<typeof setInterval>;
  screencastSessionId: number;
  sessionId: StoreId.Session;
  subdomain: ProjectSubdomain;
  // Stable, externally-meaningful target id: `${subdomain}/${sessionId}`.
  // Used as the manager Map key, the CDP URL path component, and the wire
  // identifier in BrowserConfig. Independent of webContents.id (which becomes
  // undefined after destruction in Electron 41+, electron/electron#50249).
  targetId: BrowserTargetId;
  view: WebContentsView;
}

export function createEntry({
  partitionDir,
  sessionId,
  subdomain,
  targetId,
  view,
}: {
  partitionDir: AbsolutePath;
  sessionId: StoreId.Session;
  subdomain: ProjectSubdomain;
  targetId: BrowserTargetId;
  view: WebContentsView;
}): BrowserEntry {
  return {
    authorizedDownloadPath: null,
    destructionListeners: new Set(),
    detachListeners: new Set(),
    disposers: new Set(),
    eventListeners: new Set(),
    partitionDir,
    pendingDownloadGuids: new Map(),
    screencastInterval: null,
    screencastSessionId: 0,
    sessionId,
    subdomain,
    targetId,
    view,
  };
}

export function destroyEntry(
  entries: Map<BrowserTargetId, BrowserEntry>,
  targetId: BrowserTargetId,
) {
  const entry = entries.get(targetId);
  if (!entry) {
    return;
  }
  drainDisposers(entry);
  entries.delete(targetId);
}

export function handleDetach(
  entries: Map<BrowserTargetId, BrowserEntry>,
  targetId: BrowserTargetId,
) {
  const entry = entries.get(targetId);
  if (!entry) {
    return;
  }

  for (const listener of entry.detachListeners) {
    listener();
  }
  entry.detachListeners.clear();
  entry.eventListeners.clear();

  drainDisposers(entry);
  entries.delete(targetId);
}

export function subscribeEvents({
  ensureDebuggerAttached,
  entries,
  onDetach,
  onEvent,
  targetId,
}: {
  ensureDebuggerAttached: (entry: BrowserEntry) => void;
  entries: Map<BrowserTargetId, BrowserEntry>;
  onDetach: () => void;
  onEvent: (method: string, params: unknown) => void;
  targetId: BrowserTargetId;
}): () => void {
  const entry = entries.get(targetId);
  if (!entry) {
    onDetach();
    return noop;
  }

  ensureDebuggerAttached(entry);

  entry.eventListeners.add(onEvent);
  entry.detachListeners.add(onDetach);

  return () => {
    entry.eventListeners.delete(onEvent);
    entry.detachListeners.delete(onDetach);
    // Keep the debugger attached so subsequent connections (e.g. a second
    // agent-browser invocation in the same session) can reuse the target
    // without the entry being destroyed by the detach event.
  };
}

function drainDisposers(entry: BrowserEntry) {
  for (const dispose of entry.disposers) {
    try {
      dispose();
    } catch (error) {
      log.warn(
        `disposer threw targetId=${entry.targetId} err=${String(error)}`,
      );
    }
  }
  entry.disposers.clear();
}
