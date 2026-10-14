import { noteTyped } from "@/electron-main/browser-view/history-intents";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import {
  getHistoryStore,
  recordFileOpen,
} from "@/electron-main/browser-view/history-store";
import {
  liveRead,
  readMovedPaths,
  remapMovedPath,
} from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { base } from "../base";

const SinceSchema = z.object({
  /** Epoch ms; absent means all time. */
  since: z.number().optional(),
});

/**
 * Removes every visit at or after `since`, the person's and an agent's, and
 * every page left with no visits. `removed` counts the visits.
 */
const clear = base
  .input(SinceSchema)
  .output(z.object({ removed: z.number() }))
  .handler(({ input }) => getHistoryStore().clear(input.since));

/**
 * What clearing from `since` would take, as the person sees it: how many
 * pages they visited visibly in that time, and those pages' hosts,
 * most-visited first.
 */
const summary = base
  .input(SinceSchema)
  .output(z.object({ count: z.number(), hosts: z.array(z.string()) }))
  .handler(({ input }) => getHistoryStore().summary(input.since));

const PageSchema = z.object({
  /** When the person last visited it, epoch ms. */
  at: z.number(),
  favicon: z.string().optional(),
  title: z.string(),
  typedCount: z.number(),
  url: z.string(),
  visitCount: z.number(),
});

/** Enough pages for the lists drawn from history to filter down to what they show. */
const LIMIT_MAX = 500;

/**
 * Tells history the person is opening a page by its address, typed in the
 * address field or picked from a bookmark, which a guest's events cannot
 * say. Said before the load starts.
 */
const noteTypedPage = base
  .input(z.object({ url: z.string() }))
  .handler(({ input }) => {
    noteTyped(input.url);
  });

/**
 * The person opened a file in one of the app's tabs. Every way in lands on
 * the file screen, which says so once each time a file comes up in a tab
 * they are looking at.
 */
const noteFileOpened = base
  .input(z.object({ path: z.string() }))
  .handler(({ input }) => {
    recordFileOpen(input.path, "tab");
  });

/** Takes a page off the person's history, for "Remove from Recent Pages". */
const remove = base
  .input(z.object({ url: z.string() }))
  .handler(({ input }) => {
    getHistoryStore().remove(input.url);
  });

const OpenedFileSchema = z.object({
  /** When the person last opened it, epoch ms. */
  at: z.number(),
  openCount: z.number(),
  path: z.string(),
});

const live = {
  /** The files the person opened, most recently opened first. */
  files: base
    .input(z.object({ limit: z.number().max(LIMIT_MAX).default(LIMIT_MAX) }))
    .output(eventIterator(z.array(OpenedFileSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      yield* liveRead({
        changes: [store.changes.subscribe("changed", { signal })],
        read: () => whereFilesAreNow(store.openedFiles(input.limit)),
      });
    }),
  /**
   * The pages the address field completes to: Chromium's significant ones,
   * typed at least once, visited four times, or visited in the last three
   * days. Newest first.
   */
  completions: base
    .input(z.object({ limit: z.number().max(LIMIT_MAX).default(LIMIT_MAX) }))
    .output(eventIterator(z.array(PageSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      yield* liveRead({
        changes: [store.changes.subscribe("changed", { signal })],
        read: () => store.significant(input.limit, Date.now()),
      });
    }),
  /** The person's visible pages, newest first. */
  recent: base
    .input(z.object({ limit: z.number().max(LIMIT_MAX).default(LIMIT_MAX) }))
    .output(eventIterator(z.array(PageSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      yield* liveRead({
        changes: [store.changes.subscribe("changed", { signal })],
        read: () => store.recent(input.limit),
      });
    }),
};

export const history = {
  clear,
  live,
  noteFileOpened,
  noteTypedPage,
  remove,
  summary,
};

/**
 * The opened files where they are now: one a migration moved is read back
 * where it went, and two that land on one file are one, at its latest open.
 * In the order given, newest first.
 */
function whereFilesAreNow(
  files: z.output<typeof OpenedFileSchema>[],
): z.output<typeof OpenedFileSchema>[] {
  const moves = readMovedPaths(workspaceMachineDir());
  const byPath = new Map<string, z.output<typeof OpenedFileSchema>>();
  for (const file of files) {
    const now = remapMovedPath(file.path, moves);
    const seen = byPath.get(now);
    byPath.set(
      now,
      seen
        ? {
            at: Math.max(seen.at, file.at),
            openCount: seen.openCount + file.openCount,
            path: now,
          }
        : { ...file, path: now },
    );
  }
  return [...byPath.values()];
}
