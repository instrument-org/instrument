import { useState } from "react";

import { type Tab, type TabId } from "@/shared/tabs";

/**
 * The tabs a launch restored behind the one in front, each drawn only once it
 * first comes up, so a window back with many tabs draws one. A tab opened
 * since is drawn at once, and every tab drawn stays mounted.
 */
export function useRestoredTabsWaiting(
  tabs: readonly Tab[],
  selectedId: null | TabId,
): ReadonlySet<TabId> {
  const [waiting, setWaiting] = useState<ReadonlySet<TabId>>(
    () =>
      new Set(tabs.flatMap((tab) => (tab.id === selectedId ? [] : [tab.id]))),
  );
  if (selectedId && waiting.has(selectedId)) {
    const next = new Set(waiting);
    next.delete(selectedId);
    setWaiting(next);
  }
  return waiting;
}
