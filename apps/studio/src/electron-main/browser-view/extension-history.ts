import { z } from "zod";

import {
  type HistoryTransition,
  type PersonVisit,
  type PersonPage,
} from "./history-store";

/** A page as `chrome.history` describes one (`HistoryItem`). */
export type ChromeHistoryItem = {
  id: string;
  lastVisitTime: number;
  title: string;
  typedCount: number;
  url: string;
  visitCount: number;
};

/** The core page transitions the history can tell apart, as Chrome names them. */
export type ChromeTransition = "link" | "typed";

/** A visit as `chrome.history` describes one (`VisitItem`). */
export type ChromeVisitItem = {
  id: string;
  isLocal: true;
  referringVisitId: string;
  transition: ChromeTransition;
  visitId: string;
  visitTime: number;
};

/** How many pages a search answers with when the query says nothing, as in Chrome. */
const DEFAULT_MAX_RESULTS = 100;

/** How far back a search looks when the query names no start, Chrome's 24 hours. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** A time as an extension gives one: epoch ms, or a `Date` a structured clone kept. */
const TimeSchema = z.union([
  z.number(),
  z.date().transform((date) => date.getTime()),
]);

/** What `chrome.history.search` takes. */
export const HistoryQuerySchema = z
  .looseObject({
    endTime: TimeSchema.optional(),
    maxResults: z.number().int().min(0).optional(),
    startTime: TimeSchema.optional(),
    text: z.string().catch(""),
  })
  .catch({ text: "" });

export type HistoryQuery = z.output<typeof HistoryQuerySchema>;

/** What `chrome.history.getVisits` and `deleteUrl` take. */
export const UrlDetailsSchema = z.looseObject({ url: z.string() });

/** What `chrome.history.deleteRange` takes. */
export const DeleteRangeSchema = z.looseObject({
  endTime: TimeSchema,
  startTime: TimeSchema,
});

/**
 * The time a search reads visits in, from `since` to before `before`: the
 * query's own, or from 24 hours before `now` with no end, as in Chrome.
 */
export function searchRange(
  query: HistoryQuery,
  now: number,
): { before: number; since: number } {
  return {
    before: query.endTime ?? Number.MAX_SAFE_INTEGER,
    since: query.startTime ?? now - DEFAULT_LOOKBACK_MS,
  };
}

/**
 * The pages a `chrome.history.search` query matches, of those visited in its
 * time, in the order given (latest visit first), at most `maxResults` (100
 * when it names none, every one for 0, as in Chrome). Each word of `text`
 * has to appear in the address or the title, in any case; Chrome matches a
 * word's start, which this loosens to anywhere in it.
 */
export function searchHistory(
  pages: readonly PersonPage[],
  query: HistoryQuery,
): ChromeHistoryItem[] {
  const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
  const found = pages.filter((page) => {
    const text = `${page.url} ${page.title}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const limit = query.maxResults ?? DEFAULT_MAX_RESULTS;
  return (limit === 0 ? found : found.slice(0, limit)).map(toHistoryItem);
}

export function toHistoryItem(page: PersonPage): ChromeHistoryItem {
  return {
    id: String(page.id),
    lastVisitTime: page.lastVisit,
    title: page.title,
    typedCount: page.typedCount,
    url: page.url,
    visitCount: page.visitCount,
  };
}

/**
 * A visit's transition as Chrome names it. The history keeps three, which
 * map as closely as what it records allows:
 *
 * - `typed` (the address field, or a bookmark) is `typed`. Chrome says
 *   `auto_bookmark` for a bookmark, which the history does not tell apart.
 * - `link` (a link, a page moving itself, a client redirect, the app or an
 *   agent opening a page) is `link`. Chrome's `form_submit`, `generated`,
 *   `keyword`, `keyword_generated` and `auto_toplevel` all land here, since
 *   nothing records them.
 * - `back_forward` is a qualifier in Chrome, not a transition: a step keeps
 *   the transition its entry was first reached by. So it reads as the last
 *   visit to the address before it that was not a step (`steppedFrom`), or
 *   `link` when history no longer has one.
 *
 * Chrome's `reload` never comes up, since a reload adds no visit, and
 * neither do `auto_subframe` and `manual_subframe`, since only a tab's own
 * page is recorded.
 */
export function chromeTransition(
  transition: HistoryTransition,
  steppedFrom?: HistoryTransition,
): ChromeTransition {
  switch (transition) {
    case "typed": {
      return "typed";
    }
    case "link": {
      return "link";
    }
    case "back_forward": {
      return steppedFrom === undefined || steppedFrom === "back_forward"
        ? "link"
        : chromeTransition(steppedFrom);
    }
  }
}

/** A visit as an extension reads it; a visit with no visible one before it names `"0"` as its referrer, as Chrome does. */
export function toVisitItem(visit: PersonVisit): ChromeVisitItem {
  return {
    id: String(visit.urlId),
    isLocal: true,
    referringVisitId: String(visit.fromVisit ?? 0),
    transition: chromeTransition(visit.transition, visit.steppedFrom),
    visitId: String(visit.id),
    visitTime: visit.at,
  };
}
