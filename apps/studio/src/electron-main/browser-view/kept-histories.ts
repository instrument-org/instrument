import { type BrowserTargetId } from "@instrument-org/workspace/electron";

/** How many histories are kept; the one kept longest ago goes first. */
const HISTORIES_KEPT = 200;

/**
 * The histories of guests that have gone, or gone on, each for the guest that
 * comes back at `url` under its target. In memory alone, as the guests are.
 */
export function createKeptHistories<History extends { url: string }>() {
  const kept = new Map<BrowserTargetId, History>();
  return {
    clear: () => {
      kept.clear();
    },
    forget: (targetId: BrowserTargetId) => {
      kept.delete(targetId);
    },
    keep: (targetId: BrowserTargetId, history: History | null) => {
      kept.delete(targetId);
      if (!history) {
        return;
      }
      kept.set(targetId, history);
      const [oldest] = kept.keys();
      if (kept.size > HISTORIES_KEPT && oldest !== undefined) {
        kept.delete(oldest);
      }
    },
    /**
     * The history of a tab coming back, spent as it is taken. Nothing where
     * the tab comes back at another address than the one it was kept at,
     * which that history does not lead to.
     */
    take: (targetId: BrowserTargetId, url: string | undefined) => {
      const history = kept.get(targetId) ?? null;
      kept.delete(targetId);
      return history?.url === url ? history : null;
    },
  };
}
