import { type HistoryAction } from "@instrument-org/workspace/electron";

import { downloadsBetween } from "./download-list";
import { getHistoryStore } from "./history-store";

/**
 * What the person did that the browser keeps, as Activity reads it
 * (`readPersonHistory` on the workspace's config): the pages and file opens
 * `history.db` keeps and the downloads the download list keeps, from `since`
 * to `until`, newest first, at most `limit` (all without one).
 */
export function personHistory(range: {
  limit?: number;
  since: number;
  until: number;
}): HistoryAction[] {
  const merged = [
    ...getHistoryStore().personHistory(range),
    ...downloadsBetween(range),
  ].toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return range.limit === undefined ? merged : merged.slice(0, range.limit);
}
