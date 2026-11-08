import { noteTyped } from "@/electron-main/browser-view/history-intents";
import {
  getHistoryStore,
  recordFileOpen,
  touchesPage,
} from "@/electron-main/browser-view/history-store";
import { distinct, liveRead, where } from "@instrument-org/workspace/electron";
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

/** How many to answer: as many as the caller shows, or enough to filter down from. */
const LimitSchema = z.object({
  limit: z.number().int().positive().max(LIMIT_MAX).default(LIMIT_MAX),
});

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
    .input(LimitSchema)
    .output(eventIterator(z.array(OpenedFileSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      yield* distinct(
        liveRead({
          changes: [store.changes.subscribe("files", { signal })],
          read: () => store.openedFiles(input.limit),
        }),
      );
    }),
  /**
   * The pages the address field completes to: Chromium's significant ones,
   * typed at least once, visited four times, or visited in the last three
   * days. Newest first.
   */
  completions: base
    .input(LimitSchema)
    .output(eventIterator(z.array(PageSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      // An agent's visit is a change that no completion shows.
      yield* distinct(
        liveRead({
          changes: [store.changes.subscribe("pages", { signal })],
          read: () => store.significant(input.limit, Date.now()),
        }),
      );
    }),
  /**
   * The title a page set when last opened in the app's browser, for a link
   * written as its address; null when no tab has opened it.
   */
  title: base
    .input(z.object({ url: z.string() }))
    .output(eventIterator(z.string().nullable()))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      // Read again only for a write to this page; a visit to it can still
      // leave its title as it was.
      yield* distinct(
        liveRead({
          changes: [
            where(store.changes.subscribe("pages", { signal }), (change) =>
              touchesPage(change, input.url),
            ),
          ],
          read: () => store.titleOf(input.url) ?? null,
        }),
      );
    }),
  /** The person's visible pages, newest first. */
  recent: base
    .input(LimitSchema)
    .output(eventIterator(z.array(PageSchema)))
    .handler(async function* ({ input, signal }) {
      const store = getHistoryStore();
      // An agent's visit is a change that no recent page shows.
      yield* distinct(
        liveRead({
          changes: [store.changes.subscribe("pages", { signal })],
          read: () => store.recent(input.limit),
        }),
      );
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
