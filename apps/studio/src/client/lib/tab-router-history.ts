import { type TabHistory } from "@/shared/tabs";

import { type TabRouter } from "./tab-router";

// createMemoryHistory mutates the `initialEntries` array it's given in place
// (push/splice on navigation), so we keep a reference per router and read it
// back for the live history stack -- no navigation subscription needed.
export const routerEntries = new WeakMap<object, string[]>();

/** Snapshot a tab router's current back/forward stack, for restoring on reopen. */
export function getRouterHistory(router: TabRouter): TabHistory {
  const entries = routerEntries.get(router);
  // Fall back to the current location if the reference was lost (e.g. an HMR
  // module swap) so the snapshot is always a valid, non-empty stack.
  if (!entries || entries.length === 0) {
    return { entries: [router.history.location.href], index: 0 };
  }
  return {
    entries: [...entries],
    index: router.history.location.state.__TSR_index,
  };
}

/**
 * Puts a router's back/forward stack at the addresses `move` gives it: the
 * entries behind and ahead in place, and the one it stands on by replacing
 * it, so the router goes there and whatever follows the router hears of it.
 */
export function moveRouterEntries(
  router: TabRouter,
  move: (href: string) => string,
) {
  const entries = routerEntries.get(router);
  const index = router.history.location.state.__TSR_index;
  entries?.forEach((entry, at) => {
    if (at !== index) {
      entries[at] = move(entry);
    }
  });
  const here = router.history.location.href;
  const moved = move(here);
  if (moved !== here) {
    router.history.replace(moved);
  }
}
