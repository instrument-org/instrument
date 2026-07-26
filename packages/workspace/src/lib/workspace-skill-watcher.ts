import type { AsyncSubscription, SubscribeCallback } from "@parcel/watcher";

import fs from "node:fs/promises";
import { noop } from "radashi";

import { publisher } from "../rpc/publisher";
import { SKILL_ARTIFACT_WATCHER_IGNORE } from "./skill-artifact-ignore";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

const DEBOUNCE_MS = 150;

interface ParcelWatcherApi {
  subscribe: (
    dir: string,
    callback: SubscribeCallback,
  ) => Promise<AsyncSubscription>;
}

interface WatcherEntry {
  debounceTimer: null | ReturnType<typeof setTimeout>;
  disposed: boolean;
  init: Promise<void>;
  refCount: number;
  subscription: AsyncSubscription | null;
}

let ACTIVE: undefined | WatcherEntry;
let PARCEL_PROMISE: Promise<ParcelWatcherApi | undefined> | undefined;

/**
 * Keeps one process-level watcher alive while any client subscribes to skill
 * changes. Transcript attribution is deliberately separate and session-owned.
 */
export async function startWatchingWorkspaceSkills(): Promise<
  () => Promise<void>
> {
  const existing = ACTIVE;
  if (existing) {
    existing.refCount += 1;
    await existing.init;
    return () => release(existing);
  }

  const entry: WatcherEntry = {
    debounceTimer: null,
    disposed: false,
    init: Promise.resolve(),
    refCount: 1,
    subscription: null,
  };
  ACTIVE = entry;
  entry.init = initialize(entry);
  await entry.init;
  return () => release(entry);
}

/** Stops the native subscription before the Node environment is torn down. */
export async function stopWorkspaceSkillWatcher(): Promise<void> {
  const entry = ACTIVE;
  if (!entry) {
    return;
  }
  ACTIVE = undefined;
  entry.disposed = true;
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  await entry.init.catch(noop);
  await entry.subscription?.unsubscribe().catch(noop);
  entry.subscription = null;
}

async function initialize(entry: WatcherEntry) {
  try {
    const skillsDir = getWorkspaceSkillsDir();
    await fs.mkdir(skillsDir, { recursive: true });
    const parcel = await loadParcelWatcher();
    if (!parcel || isDisposed(entry)) {
      return;
    }
    const subscription = await parcel.subscribe(
      skillsDir,
      (error, events) => {
        if (error) {
          getWorkspaceConfig().captureException(error);
          return;
        }
        if (events.length === 0 || isDisposed(entry)) {
          return;
        }
        if (entry.debounceTimer) {
          clearTimeout(entry.debounceTimer);
        }
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          if (!isDisposed(entry)) {
            publisher.publish("skill.changed", null);
          }
        }, DEBOUNCE_MS);
      },
      { ignore: SKILL_ARTIFACT_WATCHER_IGNORE },
    );
    if (isDisposed(entry)) {
      await subscription.unsubscribe().catch(noop);
      return;
    }
    entry.subscription = subscription;
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
}

function isDisposed(entry: WatcherEntry) {
  return entry.disposed;
}

async function loadParcelWatcher(): Promise<ParcelWatcherApi | undefined> {
  PARCEL_PROMISE ??= (async () => {
    try {
      const mod = await import("@parcel/watcher");
      return (mod as { default?: ParcelWatcherApi }).default ?? mod;
    } catch (error) {
      getWorkspaceConfig().captureException(error);
      return;
    }
  })();
  return PARCEL_PROMISE;
}

async function release(entry: WatcherEntry) {
  entry.refCount -= 1;
  if (entry.refCount > 0) {
    return;
  }
  entry.disposed = true;
  if (ACTIVE === entry) {
    ACTIVE = undefined;
  }
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  await entry.init;
  await entry.subscription?.unsubscribe().catch((error: unknown) => {
    getWorkspaceConfig().captureException(error);
  });
  entry.subscription = null;
}
