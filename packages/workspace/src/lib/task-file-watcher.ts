import type {
  AsyncSubscription,
  Options,
  SubscribeCallback,
} from "@parcel/watcher";

import { type CaptureExceptionFunction } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { noop } from "radashi";

import { publisher } from "../rpc/publisher";
import { RelativePathSchema, type TaskDir } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { taskDir } from "./app-dir-utils";
import { getIgnore } from "./get-ignore";
import { getMimeType } from "./get-mime-type";
import {
  diffTaskFileIndexes,
  getTaskFileIndex,
  INTERNAL_IGNORE_PATTERNS,
  MAX_TASK_FILE_INDEX_FILES,
  type TaskFile,
  type TaskFileChange,
  type TaskFileIndex,
  taskFilesFromIndex,
} from "./get-task-files";
import { normalizePath } from "./normalize-path";

// Trailing window used to coalesce bursts of filesystem events (agents and
// editors write many files in quick succession) into a single publish.
const DEBOUNCE_MS = 150;
// Re-walk cadence used only when the native watcher binding is unavailable.
const FALLBACK_POLL_MS = 5000;
// Pin the in-process native backend per platform. Auto-detection prefers
// Watchman when it's on PATH, but on Windows that path pops a console window
// and stalls subscribe for seconds (parcel-bundler/watcher#155, #168). Forcing
// the OS-native backend bypasses Watchman entirely; an unavailable choice
// silently falls back to the platform default.
const NATIVE_BACKEND: Options["backend"] =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "fs-events"
      : "inotify";

type Ignore = Awaited<ReturnType<typeof getIgnore>>;

// Minimal surface of @parcel/watcher we depend on; loaded dynamically so the
// native binding resolves from node_modules at runtime instead of being bundled.
interface ParcelWatcherApi {
  subscribe: (
    dir: string,
    callback: SubscribeCallback,
    opts?: Options,
  ) => Promise<AsyncSubscription>;
}

// Per-turn state: the file index snapshotted at turn start (diffed against an
// authoritative walk at turn end) plus the watcher ref acquired for the turn.
interface TurnTracker {
  before: TaskFileIndex;
  release: () => void;
}

interface WatcherEntry {
  // Realpath of dir. macOS fs-events reports canonical paths (e.g.
  // /private/var/...) so we resolve relative paths against this base.
  baseDir: string;
  captureException: CaptureExceptionFunction;
  debounceTimer: null | ReturnType<typeof setTimeout>;
  dir: TaskDir;
  disposed: boolean;
  fallbackTimer: null | ReturnType<typeof setInterval>;
  id: TaskId;
  // Null until the first seed completes; seeding always precedes event handling.
  ignore: Ignore | null;
  index: TaskFileIndex;
  // Absolute paths buffered between debounce flushes.
  pendingPaths: Set<string>;
  // Resolves once the initial seed completes, so turn snapshots are accurate.
  ready: Promise<void>;
  refCount: number;
  resolveReady: () => void;
  seeded: boolean;
  subscription: null | { unsubscribe: () => Promise<void> };
  // Per-session turn trackers; populated only while a turn is in flight.
  turns: Map<StoreId.Session, TurnTracker>;
}

const REGISTRY = new Map<TaskId, WatcherEntry>();

let PARCEL_PROMISE: Promise<ParcelWatcherApi | undefined> | undefined;

/**
 * Starts tracking on-disk changes for a turn. Holds a watcher open for the
 * id (ref-counted) and snapshots the current file index as the turn's
 * "before" state. Awaits the initial seed so the snapshot reflects pre-turn
 * state. Must be paired with {@link consumeTurnChanges} to release the watcher.
 */
export async function beginTurnChangeTracking({
  id,
  sessionId,
  workspaceConfig,
}: {
  id: TaskId;
  sessionId: StoreId.Session;
  workspaceConfig: WorkspaceConfig;
}): Promise<void> {
  const release = startWatchingTaskFiles({ id, workspaceConfig });
  const entry = REGISTRY.get(id);
  if (!entry) {
    release();
    return;
  }

  // Re-tracking an already-tracked session would leak the existing ref.
  if (entry.turns.has(sessionId)) {
    release();
    return;
  }

  await entry.ready;
  if (entry.disposed) {
    release();
    return;
  }
  entry.turns.set(sessionId, { before: new Map(entry.index), release });
}

/**
 * Diffs a turn's "before" snapshot against an authoritative walk of disk and
 * releases the watcher ref acquired by {@link beginTurnChangeTracking}. The walk
 * makes the result correct regardless of filesystem-event latency. Safe to call
 * unconditionally; returns an empty list when nothing was tracked.
 */
export async function consumeTurnChanges({
  id,
  sessionId,
}: {
  id: TaskId;
  sessionId: StoreId.Session;
}): Promise<{ after?: TaskFileIndex; changes: TaskFileChange[] }> {
  const entry = REGISTRY.get(id);
  const turn = entry?.turns.get(sessionId);
  if (!entry || !turn) {
    return { changes: [] };
  }

  entry.turns.delete(sessionId);
  try {
    const after = await refreshIndex(entry);
    return {
      after: new Map(after),
      changes: diffTaskFileIndexes({ after, before: turn.before }),
    };
  } catch (error) {
    entry.captureException(error);
    return { changes: [] };
  } finally {
    turn.release();
  }
}

/**
 * Returns a copy of the current in-memory file index for a id, or
 * undefined when no watcher is active. Lets callers diff against the index the
 * watcher already maintains instead of walking disk again.
 */
export function getCurrentTaskFileIndex(id: TaskId): TaskFileIndex | undefined {
  const entry = REGISTRY.get(id);
  if (!entry?.seeded) {
    return undefined;
  }
  return new Map(entry.index);
}

/**
 * Returns the current in-memory file list for a id, or undefined when no
 * watcher is active (callers fall back to a fresh walk in that case).
 */
export function getCurrentTaskFiles(id: TaskId): TaskFile[] | undefined {
  const entry = REGISTRY.get(id);
  if (!entry?.seeded) {
    return undefined;
  }
  return taskFilesFromIndex(entry.index);
}

/**
 * Begins watching a task's files, maintaining an incremental in-memory index
 * and publishing `project.files.changed` as the tree changes. Idempotent per
 * id via ref-counting; returns a disposer that stops watching once the
 * last holder releases.
 */
export function startWatchingTaskFiles({
  id,
  workspaceConfig,
}: {
  id: TaskId;
  workspaceConfig: WorkspaceConfig;
}): () => void {
  const existing = REGISTRY.get(id);
  if (existing) {
    existing.refCount += 1;
    return () => {
      releaseWatcher(id);
    };
  }

  const dir = taskDir(id);
  let resolveReady: () => void = noop;
  const ready = new Promise<void>((resolve) => {
    resolveReady = () => {
      resolve();
    };
  });
  const entry: WatcherEntry = {
    baseDir: dir,
    captureException: workspaceConfig.captureException,
    debounceTimer: null,
    dir,
    disposed: false,
    fallbackTimer: null,
    id,
    ignore: null,
    index: new Map(),
    pendingPaths: new Set(),
    ready,
    refCount: 1,
    resolveReady,
    seeded: false,
    subscription: null,
    turns: new Map(),
  };
  REGISTRY.set(id, entry);

  void initWatcher(entry);

  return () => {
    releaseWatcher(id);
  };
}

/** Reflects a single changed absolute path into the index. Returns true when the index actually changed. */
async function applyChangedPath(
  entry: WatcherEntry,
  absPath: string,
): Promise<boolean> {
  const relative = toRelative(entry, absPath);
  if (relative === undefined || !entry.ignore) {
    return false;
  }

  const key = relative;
  if (entry.ignore.ignores(relative) || entry.ignore.ignores(`${relative}/`)) {
    return deleteSubtree(entry, key);
  }

  try {
    const stats = await fs.lstat(absPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return false;
    }
    const previous = entry.index.get(key);
    if (!previous && entry.index.size >= MAX_TASK_FILE_INDEX_FILES) {
      return false;
    }
    if (
      previous &&
      previous.size === stats.size &&
      previous.mtimeMs === stats.mtimeMs
    ) {
      return false;
    }
    entry.index.set(key, {
      filename: path.basename(relative),
      filePath: RelativePathSchema.parse(key),
      mimeType: getMimeType(relative),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
    return true;
  } catch {
    // Missing path: the file (or a directory) was removed.
    return deleteSubtree(entry, key);
  }
}

function deleteSubtree(entry: WatcherEntry, key: string): boolean {
  let changed = entry.index.delete(key);
  const prefix = `${key}/`;
  for (const existing of entry.index.keys()) {
    if (existing.startsWith(prefix)) {
      entry.index.delete(existing);
      changed = true;
    }
  }
  return changed;
}

/** Applies buffered path events to the index (or re-walks on a .gitignore change), then publishes if anything changed. */
async function flush(entry: WatcherEntry) {
  if (isDisposed(entry)) {
    return;
  }
  const paths = [...entry.pendingPaths];
  entry.pendingPaths.clear();

  // A .gitignore change can alter which files are visible; rebuild the ignore
  // matcher and re-walk rather than reasoning about every affected path.
  if (paths.some((p) => path.basename(p) === ".gitignore")) {
    await refreshIndex(entry);
    return;
  }

  let changed = false;
  for (const absPath of paths) {
    try {
      if (await applyChangedPath(entry, absPath)) {
        changed = true;
      }
    } catch (error) {
      entry.captureException(error);
    }
  }

  if (changed && !isDisposed(entry)) {
    publisher.publish("task.files.changed", { id: entry.id });
  }
}

/** One-time setup for a new entry: seeds the index, then attaches a parcel subscription or the fallback poll. */
async function initWatcher(entry: WatcherEntry) {
  try {
    entry.baseDir = await fs.realpath(entry.dir).catch(() => entry.dir);
    await reseed(entry);
  } catch (error) {
    entry.captureException(error);
  }
  // Unblock turn baseline capture once seeding has run (success or failure).
  entry.resolveReady();
  if (isDisposed(entry)) {
    return;
  }

  // Sync any live subscriber to the freshly seeded index, closing the window
  // between the subscriber's initial walk and the first watcher event.
  if (entry.seeded) {
    publisher.publish("task.files.changed", { id: entry.id });
  }

  const parcel = await loadParcelWatcher();
  if (isDisposed(entry)) {
    return;
  }

  if (!parcel) {
    // No native binding: this should never happen given the prebuilt
    // bindings we ship for every supported platform, so treat it as
    // exceptional. Still degrade to a low-frequency re-walk so the live
    // subscription reflects changes (only while a watcher is held).
    entry.captureException(
      new Error("project file watcher: native binding unavailable"),
      { scopes: ["workspace"] },
    );
    entry.fallbackTimer = setInterval(() => {
      void refreshIndex(entry);
    }, FALLBACK_POLL_MS);
    return;
  }

  try {
    const subscription = await parcel.subscribe(
      entry.baseDir,
      (error, events) => {
        if (error || isDisposed(entry)) {
          return;
        }
        for (const event of events) {
          entry.pendingPaths.add(event.path);
        }
        scheduleFlush(entry);
      },
      { backend: NATIVE_BACKEND, ignore: INTERNAL_IGNORE_PATTERNS },
    );
    if (isDisposed(entry)) {
      await subscription.unsubscribe().catch(noop);
      return;
    }
    entry.subscription = subscription;
  } catch (error) {
    entry.captureException(error);
  }
}

function isDisposed(entry: WatcherEntry): boolean {
  return entry.disposed;
}

function loadParcelWatcher(): Promise<ParcelWatcherApi | undefined> {
  PARCEL_PROMISE ??= (async () => {
    try {
      const mod = await import("@parcel/watcher");
      // CJS/ESM interop: the API is exposed on `default` under some modes and
      // at the top level under others.
      return (mod as { default?: ParcelWatcherApi }).default ?? mod;
    } catch {
      return;
    }
  })();
  return PARCEL_PROMISE;
}

/** Re-walks disk to make the index authoritative, publishing if it changed, and returns the refreshed index. */
async function refreshIndex(entry: WatcherEntry): Promise<TaskFileIndex> {
  const before = taskFilesFromIndex(entry.index);
  await reseed(entry);
  if (
    !isDisposed(entry) &&
    JSON.stringify(before) !== JSON.stringify(taskFilesFromIndex(entry.index))
  ) {
    publisher.publish("task.files.changed", { id: entry.id });
  }
  return entry.index;
}

/** Drops a ref; tears down timers, the subscription, and the registry entry once the last holder releases. */
function releaseWatcher(id: TaskId) {
  const entry = REGISTRY.get(id);
  if (!entry) {
    return;
  }
  entry.refCount -= 1;
  if (entry.refCount > 0) {
    return;
  }
  entry.disposed = true;
  REGISTRY.delete(id);
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  if (entry.fallbackTimer) {
    clearInterval(entry.fallbackTimer);
  }
  entry.subscription?.unsubscribe().catch(noop);
}

/** Rebuilds the ignore matcher and walks disk to produce a fresh, authoritative index; marks the entry seeded. */
async function reseed(entry: WatcherEntry) {
  entry.ignore = await getIgnore(entry.dir);
  entry.ignore.add(INTERNAL_IGNORE_PATTERNS);
  const result = await getTaskFileIndex(entry.dir);
  if (isDisposed(entry)) {
    return;
  }
  if (result.isErr()) {
    entry.captureException(result.error);
    return;
  }
  entry.index = result.value;
  entry.seeded = true;
}

/** Restarts the debounce timer so a burst of events collapses into one flush. */
function scheduleFlush(entry: WatcherEntry) {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void flush(entry);
  }, DEBOUNCE_MS);
}

/** Resolves an absolute event path to a POSIX path relative to the task dir, tolerating both the canonical and the original spelling of the base dir. */
function toRelative(entry: WatcherEntry, absPath: string): string | undefined {
  for (const base of new Set([entry.baseDir, entry.dir])) {
    const relative = normalizePath(path.relative(base, absPath));
    if (relative && relative !== "." && !relative.startsWith("..")) {
      return relative;
    }
  }
  return undefined;
}
