/**
 * The plumbing every live file editor shares (Markdown, code, CSV): the disk
 * queue its saves and reads run through, the save that follows the person
 * leaving, and the watch that pulls the agent's writes in.
 */
import { logger } from "@/client/lib/logger";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export type SaveStatus = "error" | "saved" | "saving" | "unsaved";

/** How long the part of a file an agent's write changed stays lit. */
export const AGENT_FLASH_MS = 1800;

/** How long editing rests before a save, and the longest a save waits under steady editing. */
const SAVE_DEBOUNCE_MS = 400;
const SAVE_MAX_WAIT_MS = 2000;
/** How many rounds of follow-up saves a flush waits out before settling. */
const FLUSH_ROUNDS = 5;
/** How often an open editor looks for the agent's writes. */
const WATCH_INTERVAL_MS = 250;

/**
 * One file's disk I/O as a single queue, so a merge never interleaves with a
 * save in flight. Saves are debounced, but never postponed past the max wait:
 * a steady stream of edits or agent writes must not keep the person's changes
 * off disk. A task that throws reports an error status and the queue goes on.
 */
export function createSaveQueue({
  label,
  onStatus,
  save,
}: {
  /** Names the editor in the log when a task fails. */
  label: string;
  onStatus: (status: SaveStatus, detail?: string) => void;
  save: () => Promise<void>;
}) {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => {
      logger.error(`${label}:`, error);
      onStatus(
        "error",
        error instanceof Error ? error.message : "Could not save",
      );
    });
    return queue;
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueued = false;
  let pendingSince = 0;
  const queueSave = () => {
    if (saveQueued) {
      return;
    }
    saveQueued = true;
    void enqueue(async () => {
      saveQueued = false;
      await save();
    });
  };

  // Read through a call: a save can schedule another while a flush awaits.
  const saveWaiting = () => saveQueued || saveTimer !== undefined;

  let pullQueued = false;

  return {
    /** Stops a scheduled save from running. */
    cancel: () => {
      clearTimeout(saveTimer);
    },
    /**
     * Runs a scheduled save now; settles once everything queued is done,
     * including the saves those saves schedule (a conflict merged in, text
     * typed while one was in flight), for a few rounds at most.
     */
    flush: async () => {
      for (let round = 0; round < FLUSH_ROUNDS; round++) {
        if (saveTimer !== undefined) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
          pendingSince = 0;
          queueSave();
        }
        await queue;
        if (!saveWaiting()) {
          return;
        }
      }
    },
    /** Whether, once the queue settles, no save is waiting. */
    idle: async () => {
      await queue;
      return !saveQueued && saveTimer === undefined;
    },
    /** Queues a read of the disk; one already waiting covers this one. */
    pull: (read: () => Promise<void>) => {
      if (pullQueued) {
        return;
      }
      pullQueued = true;
      void enqueue(async () => {
        pullQueued = false;
        await read();
      });
    },
    /** Marks the file unsaved and saves it once editing rests for `ms`. */
    schedule: (ms = SAVE_DEBOUNCE_MS) => {
      clearTimeout(saveTimer);
      pendingSince ||= Date.now();
      onStatus("unsaved");
      saveTimer = setTimeout(
        () => {
          saveTimer = undefined;
          pendingSince = 0;
          queueSave();
        },
        Math.max(0, Math.min(ms, pendingSince + SAVE_MAX_WAIT_MS - Date.now())),
      );
    },
  };
}

/**
 * Leaving is a save: the window hiding, the window closing, and, given the
 * editor's element, the caret going elsewhere. Returns the way to stop.
 */
export function flushOnLeave(flush: () => Promise<void>, editor?: HTMLElement) {
  const onFocusOut = (e: FocusEvent) => {
    if (
      !(e.relatedTarget instanceof Node) ||
      !editor?.contains(e.relatedTarget)
    ) {
      void flush();
    }
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      void flush();
    }
  };
  const onUnload = () => {
    void flush();
  };
  editor?.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("beforeunload", onUnload);
  return () => {
    editor?.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("beforeunload", onUnload);
  };
}

/**
 * Watches the file on disk, four times a second while it is open, and pulls
 * each change into the editor's session once it has one.
 */
export function usePullOnDiskChange(
  hostPath: string,
  session: null | { pull: () => void },
  { enabled = true }: { enabled?: boolean } = {},
) {
  const watched = useQuery({
    ...rpcClient.files.live.info.experimental_liveOptions({
      input: { intervalMs: WATCH_INTERVAL_MS, path: hostPath },
    }),
    enabled,
  });
  const modifiedAt = watched.data?.modifiedAt;
  useEffect(() => {
    if (modifiedAt !== undefined) {
      session?.pull();
    }
  }, [modifiedAt, session]);
}
