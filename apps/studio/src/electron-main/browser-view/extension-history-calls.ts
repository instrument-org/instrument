import { type Session } from "electron";
import { type ElectronChromeExtensions } from "electron-chrome-extensions";

import { asks } from "./extension-download-calls";
import {
  DeleteRangeSchema,
  HistoryQuerySchema,
  searchHistory,
  searchRange,
  toHistoryItem,
  toVisitItem,
  UrlDetailsSchema,
} from "./extension-history";
import { getHistoryStore } from "./history-store";

/**
 * `chrome.history` over the app's own history (`history.db`), which stays
 * the one record. An extension sees the person's visible visits alone, the
 * history's `VISIBLE`: never an agent's, and never one hidden as a redirect,
 * an error or a sign-in; files opened are not pages and are left out.
 * `deleteUrl` takes a page off the person's history as Remove from Recent
 * Pages does, and `deleteRange` and `deleteAll` clear as Clear history does,
 * agents' visits in that time included. Each visible visit the person makes
 * reaches every extension with the `history` permission as `onVisited`, and
 * every page a removal or a clear takes off their history as
 * `onVisitRemoved`, whether an extension or the person removed it. `addUrl`
 * stays the library's stand-in, which resolves and records nothing: the
 * history is also the record of what the person did, which Activity and
 * their chats read, so a page an extension adds would read as one they
 * visited.
 */
export function answerHistoryCalls(
  extensions: ElectronChromeExtensions,
  guestSession: Session,
): void {
  const store = getHistoryStore();

  const listening = () =>
    guestSession.extensions
      .getAllExtensions()
      .filter((extension) => asks(extension, "history"));

  store.changes.subscribe("visited", ({ url }) => {
    const listeners = listening();
    const page = listeners.length > 0 ? store.personPage(url) : undefined;
    if (!page) {
      return;
    }
    for (const extension of listeners) {
      extensions.sendExtensionEvent(
        extension.id,
        "history.onVisited",
        toHistoryItem(page),
      );
    }
  });
  store.changes.subscribe("removed", ({ allHistory, urls }) => {
    for (const extension of listening()) {
      extensions.sendExtensionEvent(extension.id, "history.onVisitRemoved", {
        allHistory,
        urls: [...urls],
      });
    }
  });

  const answer = (name: string, callback: (...args: unknown[]) => unknown) => {
    extensions.handleApiCall(
      `history.${name}`,
      (_event, ...args: unknown[]) => callback(...args),
      { permission: "history" },
    );
  };

  answer("search", (query) => {
    const asked = HistoryQuerySchema.parse(query);
    const { before, since } = searchRange(asked, Date.now());
    return searchHistory(store.personPages(since, before), asked);
  });

  answer("getVisits", (details) =>
    store.personVisits(UrlDetailsSchema.parse(details).url).map(toVisitItem),
  );

  answer("deleteUrl", (details) => {
    store.remove(UrlDetailsSchema.parse(details).url);
  });

  answer("deleteRange", (range) => {
    const { endTime, startTime } = DeleteRangeSchema.parse(range);
    store.clear(startTime, endTime);
  });

  answer("deleteAll", () => {
    store.clear();
  });
}
