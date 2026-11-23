import { type BrowserTargetId } from "@instrument-org/workspace/electron";

import { type BrowserEntry } from "./entry";

/** How many discarded tabs' histories are kept; the one discarded longest ago goes first. */
const DISCARDED_HISTORIES_KEPT = 200;

type GuestHistory = NonNullable<BrowserEntry["restoreHistory"]>;

/**
 * Where each discarded tab's guest stood and the pages behind it, for the
 * guest its tab comes back with. In memory alone, as the guests are.
 */
export function createDiscardedHistories() {
  const kept = new Map<BrowserTargetId, GuestHistory>();
  return {
    clear: () => {
      kept.clear();
    },
    forget: (targetId: BrowserTargetId) => {
      kept.delete(targetId);
    },
    keep: (targetId: BrowserTargetId, history: GuestHistory | null) => {
      kept.delete(targetId);
      if (!history) {
        return;
      }
      kept.set(targetId, history);
      const [oldest] = kept.keys();
      if (kept.size > DISCARDED_HISTORIES_KEPT && oldest !== undefined) {
        kept.delete(oldest);
      }
    },
    /**
     * The history of a tab coming back, spent as it is taken. Nothing where
     * the tab comes back at another address than the one it was discarded
     * at, which that history does not lead to.
     */
    take: (targetId: BrowserTargetId, url: string | undefined) => {
      const history = kept.get(targetId) ?? null;
      kept.delete(targetId);
      return history?.url === url ? history : null;
    },
  };
}
