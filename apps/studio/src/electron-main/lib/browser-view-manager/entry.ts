import type { BrowserWindow, WebContentsView } from "electron";

import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { noop } from "radashi";

import { log } from "./log";

export interface BrowserEntry {
  authorizedDownloadPath: null | string;
  detachListeners: Set<() => void>;
  // Disposers run once when the entry is torn down (either via explicit close
  // or detach). Each disposer must be idempotent-safe; it will be called at
  // most once because the set is cleared after draining.
  disposers: Set<() => void>;
  eventListeners: Set<(method: string, params: unknown) => void>;
  hostWindow: BrowserWindow;
  // Maps download URL -> GUID from Page.downloadWillBegin, consumed by will-download.
  pendingDownloadGuids: Map<string, string>;
  screencastInterval: null | ReturnType<typeof setInterval>;
  screencastSessionId: number;
  subdomain: ProjectSubdomain;
  // Captured at construction; webContents.id becomes undefined after
  // destruction in Electron 41+ (electron/electron#50249).
  targetId: string;
  view: WebContentsView;
}

export function createEntry({
  hostWindow,
  subdomain,
  targetId,
  view,
}: {
  hostWindow: BrowserWindow;
  subdomain: ProjectSubdomain;
  targetId: string;
  view: WebContentsView;
}): BrowserEntry {
  return {
    authorizedDownloadPath: null,
    detachListeners: new Set(),
    disposers: new Set(),
    eventListeners: new Set(),
    hostWindow,
    pendingDownloadGuids: new Map(),
    screencastInterval: null,
    screencastSessionId: 0,
    subdomain,
    targetId,
    view,
  };
}

export function destroyEntry(
  entries: Map<string, BrowserEntry>,
  targetId: string,
) {
  const entry = entries.get(targetId);
  if (!entry) {
    return;
  }
  drainDisposers(entry);
  entries.delete(targetId);
}

export function handleDetach(
  entries: Map<string, BrowserEntry>,
  targetId: string,
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
  entries: Map<string, BrowserEntry>;
  onDetach: () => void;
  onEvent: (method: string, params: unknown) => void;
  targetId: string;
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
