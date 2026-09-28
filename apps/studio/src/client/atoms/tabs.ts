import { freshTabId, NEW_TAB_PATH } from "@/client/lib/tab-actions";
import {
  addTab,
  emptyTabsModel,
  type TabsModel,
  TabsModelSchema,
} from "@/client/lib/tabs-model";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { debounce } from "radashi";

function freshTabsModel(pathname: string): TabsModel {
  return addTab(emptyTabsModel(), { id: freshTabId(), pathname });
}

const json = createJSONStorage<TabsModel>(() => localStorage);

/**
 * A window's tabs, kept across launches under `key`, opening on one tab at
 * `pathname` the first time. `getOnInit` so persisted tabs are present on the
 * first render: without it the atom would start from a throwaway tab and swap
 * after mount, building and discarding that tab's router.
 */
export function tabsAtomOf(key: string, pathname: string) {
  return atomWithStorage<TabsModel>(
    key,
    freshTabsModel(pathname),
    tabsStorage(),
    { getOnInit: true },
  );
}

/**
 * localStorage backing for a window's tab model. Windows of one origin share
 * the storage, so each window's model has a key of its own. A corrupt/stale
 * blob must not brick the window (it maps over `tabs`), so reads validate
 * against {@link TabsModelSchema} and fall back to the initial model on
 * failure; the versioned key covers intentional breaking changes.
 *
 * Writes coalesce the burst navigation and selection produce. A quit or
 * reload (including a dev relaunch) can fire inside the debounce window, so
 * the pending write is flushed on teardown to avoid dropping the last
 * navigation. radashi's `debounce().flush()` re-invokes with fresh args
 * instead of replaying the pending call, so the pending value is tracked here
 * rather than through it.
 */
function tabsStorage(): typeof json {
  let pendingWrite: null | { key: string; value: TabsModel } = null;
  const flushWrite = () => {
    if (!pendingWrite) {
      return;
    }
    json.setItem(pendingWrite.key, pendingWrite.value);
    pendingWrite = null;
  };
  const persist = debounce({ delay: 300 }, flushWrite);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushWrite);
    window.addEventListener("beforeunload", flushWrite);
  }
  return {
    getItem: (key: string, initialValue: TabsModel): TabsModel => {
      const parsed = TabsModelSchema.safeParse(json.getItem(key, initialValue));
      if (!parsed.success || parsed.data.tabs.length === 0) {
        return initialValue;
      }
      const stored = parsed.data;
      // Keep selection pointing at a tab that still exists.
      if (stored.tabs.some((tab) => tab.id === stored.selectedId)) {
        return stored;
      }
      return { ...stored, selectedId: stored.tabs[0]?.id ?? null };
    },
    removeItem: (key: string) => {
      pendingWrite = null;
      json.removeItem(key);
    },
    setItem: (key: string, value: TabsModel) => {
      pendingWrite = { key, value };
      persist();
    },
  };
}

export const tabsAtom = tabsAtomOf("studio.tabs.v1", NEW_TAB_PATH);
