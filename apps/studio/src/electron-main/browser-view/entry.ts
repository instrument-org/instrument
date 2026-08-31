import type { WebContents } from "electron";

import {
  type AbsolutePath,
  type BrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/electron";
import { noop } from "radashi";

import { clearGuestSurface } from "./guest-surface";
import { log } from "./log";

// Bumped per createEntry so each entry (even a recreate of a just-destroyed
// target id) gets a distinct generation the renderer pool can diff against.
let generationCounter = 0;

export interface BrowserEntry {
  // Resolves when the guest attaches, rejects if the entry is removed first.
  attach: AttachSignal;
  authorizedDownloadPath: null | string;
  // Listeners notified once when the entry is removed from the manager (for
  // any reason: explicit close, detach, renderer crash). Drained as part of
  // the disposer chain so they never fire more than once. Used to surface
  // "view destroyed" to higher layers (e.g. the taskBrowser machine).
  destructionListeners: Set<() => void>;
  detachListeners: Set<() => void>;
  // Disposers run once when the entry is torn down (either via explicit close
  // or detach). Each disposer must be idempotent-safe; it will be called at
  // most once because the set is cleared after draining.
  disposers: Set<() => void>;
  eventListeners: Set<(method: string, params: unknown) => void>;
  // Monotonic per-entry id, bumped on every createEntry. The renderer pool keys
  // its `<webview>` by targetId, which is stable across a destroy+recreate of
  // the same (task, session); the generation lets the pool notice that recreate
  // (even when the two events coalesce into one stream snapshot) and remount a
  // fresh guest instead of stranding the destroyed one.
  generation: number;
  id: TaskId;
  // Whether a main-frame navigation to a real URL has started on this guest.
  // False for the whole life of a target that only ever held `about:blank` --
  // agent-browser mints a page for any command that needs one, including
  // commands that only read existing state, so an entry existing does not mean
  // anything asked for a browser to be shown.
  navigated: boolean;
  // Workspace browser profile directory, threaded through BrowserConfig so the
  // task lifecycle can correlate a target with its storage without re-deriving
  // the path.
  partitionDir: AbsolutePath;
  // Maps download URL -> GUID from Page.downloadWillBegin, consumed by will-download.
  pendingDownloadGuids: Map<string, string>;
  screencastInterval: null | ReturnType<typeof setInterval>;
  screencastSessionId: number;
  sessionId: StoreId.Session;
  // Stable, externally-meaningful target id: `${id}/${sessionId}`.
  // Used as the manager Map key, the CDP URL path component, and the wire
  // identifier in BrowserConfig. Independent of webContents.id (which becomes
  // undefined after destruction in Electron 41+, electron/electron#50249).
  targetId: BrowserTargetId;
  // The guest `<webview>`'s WebContents, bound in `did-attach-webview`. Null
  // between createTarget (which records the entry + asks the renderer to mount
  // a guest) and the attach completing.
  webContents: null | WebContents;
}

// One-shot signal for "the guest attached (and its first load settled)". Created
// with the entry, resolved in bindGuest's did-finish-load, and rejected by
// fireDestruction if the entry is removed first (for any reason). Lets
// createTarget await attachment without a separate waiter registry, and fixes
// the hang where a createTarget racing a teardown/close would block until its
// own timeout instead of failing immediately.
interface AttachSignal {
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
  settled: boolean;
}

export function createEntry({
  id,
  partitionDir,
  sessionId,
  targetId,
}: {
  id: TaskId;
  partitionDir: AbsolutePath;
  sessionId: StoreId.Session;
  targetId: BrowserTargetId;
}): BrowserEntry {
  return {
    attach: createAttachSignal(),
    authorizedDownloadPath: null,
    destructionListeners: new Set(),
    detachListeners: new Set(),
    disposers: new Set(),
    eventListeners: new Set(),
    generation: ++generationCounter,
    id,
    navigated: false,
    partitionDir,
    pendingDownloadGuids: new Map(),
    screencastInterval: null,
    screencastSessionId: 0,
    sessionId,
    targetId,
    webContents: null,
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
  fireDestruction(entry);
  entries.delete(targetId);
  clearGuestSurface(targetId);
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
  fireDestruction(entry);
  entries.delete(targetId);
  clearGuestSurface(targetId);
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

function createAttachSignal(): AttachSignal {
  let resolveFn: () => void = noop;
  let rejectFn: (error: Error) => void = noop;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  // Swallow "unhandled rejection" if the entry is torn down before anything
  // awaits attachment; real awaiters (createTarget) still observe the rejection.
  promise.catch(noop);
  const signal: AttachSignal = {
    promise,
    reject: (error) => {
      if (!signal.settled) {
        signal.settled = true;
        rejectFn(error);
      }
    },
    resolve: () => {
      if (!signal.settled) {
        signal.settled = true;
        resolveFn();
      }
    },
    settled: false,
  };
  return signal;
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

// Notify listeners that the entry is gone (any reason: explicit close, detach,
// renderer crash, or a handshake that timed out before the guest attached).
// Fired after disposers so cleanup runs first; drained so each fires at most
// once. Centralized here so it runs even for entries that never bound a guest.
function fireDestruction(entry: BrowserEntry) {
  // Fail any in-flight createTarget immediately instead of leaving it to time
  // out; a no-op once the guest has already attached.
  entry.attach.reject(
    new Error(`agent browser target removed before attach: ${entry.targetId}`),
  );
  for (const listener of entry.destructionListeners) {
    try {
      listener();
    } catch (error) {
      log.warn(
        `destruction listener threw targetId=${entry.targetId} err=${String(error)}`,
      );
    }
  }
  entry.destructionListeners.clear();
}
