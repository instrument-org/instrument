import { keptAtom } from "@/client/lib/kept-state";
import { freshTabId } from "@/client/lib/tab-actions";
import {
  addTab,
  emptyTabsModel,
  type TabsModel,
  TabsModelSchema,
} from "@/client/lib/tabs-model";
import { type KeptKey } from "@/shared/kept-state";

function freshTabsModel(pathname: string): TabsModel {
  return addTab(emptyTabsModel(), { id: freshTabId(), pathname });
}

/**
 * A window's tabs, kept across launches under `key`, opening on one tab at
 * `pathname` the first time. A kept model that does not parse, or has no
 * tabs, opens on that one tab instead, so a stale or hand-edited value
 * cannot leave the window with nothing to show.
 */
export function tabsAtomOf(key: KeptKey, pathname: string) {
  return keptAtom<TabsModel>(
    key,
    freshTabsModel(pathname),
    (value, initial) => {
      const parsed = TabsModelSchema.safeParse(value);
      if (!parsed.success || parsed.data.tabs.length === 0) {
        return initial;
      }
      const stored = parsed.data;
      // Keep selection pointing at a tab that still exists.
      if (stored.tabs.some((tab) => tab.id === stored.selectedId)) {
        return stored;
      }
      return { ...stored, selectedId: stored.tabs[0]?.id ?? null };
    },
  );
}
