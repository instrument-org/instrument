import { TABS_STORAGE_KEY } from "@/client/lib/storage-keys";
import { freshTabId, NEW_TAB_PATH } from "@/client/lib/tab-actions";
import {
  addTab,
  emptyTabsModel,
  type TabsModel,
  TabsModelSchema,
} from "@/client/lib/tabs-model";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { debounce } from "radashi";

function freshTabsModel(): TabsModel {
  return addTab(emptyTabsModel(), {
    id: freshTabId(),
    pathname: NEW_TAB_PATH,
  });
}

const json = createJSONStorage<TabsModel>(() => localStorage);

// Latest scheduled write, held so teardown can flush it synchronously rather than
// relying on the debounce timer surviving.
let pendingWrite: null | { key: string; value: TabsModel } = null;

const flushWrite = () => {
  if (!pendingWrite) {
    return;
  }
  json.setItem(pendingWrite.key, pendingWrite.value);
  pendingWrite = null;
};

// Coalesce the burst of writes that navigation/selection produce. A quit or reload
// (including a dev relaunch) can fire inside the debounce window, so flush the
// pending write on teardown to avoid dropping the last navigation. radashi's
// `debounce().flush()` re-invokes with fresh args instead of replaying the pending
// call, so the pending value is tracked here rather than through it.
const persist = debounce({ delay: 300 }, flushWrite);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushWrite);
  window.addEventListener("beforeunload", flushWrite);
}

/**
 * localStorage backing for {@link tabsAtom}. The main window shares one origin,
 * so this survives restarts with no main-process round trip. A corrupt/stale
 * blob must not brick the window (MainWindow maps over `tabs`), so reads validate
 * against {@link TabsModelSchema} and fall back to the initial model on failure;
 * the versioned key (`studio.tabs.v1`) covers intentional breaking changes.
 */
const tabsStorage: typeof json = {
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

// `getOnInit` so persisted tabs are present on the first render: without it the
// atom would start from a throwaway new-tab and swap after mount, building and
// discarding that tab's router.
export const tabsAtom = atomWithStorage<TabsModel>(
  TABS_STORAGE_KEY,
  freshTabsModel(),
  tabsStorage,
  { getOnInit: true },
);
