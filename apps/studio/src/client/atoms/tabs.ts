import {
  addTab,
  emptyTabsModel,
  type TabsModel,
  TabsModelSchema,
} from "@/client/lib/tab-model";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { debounce } from "radashi";

const NEW_TAB_PATH = "/new-tab";

function freshTabsModel(): TabsModel {
  return addTab(emptyTabsModel(), {
    id: crypto.randomUUID(),
    pathname: NEW_TAB_PATH,
  });
}

const json = createJSONStorage<TabsModel>(() => localStorage);

// Coalesce the burst of writes that navigation/selection produce; persistence is
// best-effort, so a dropped final write on a fast quit is acceptable.
const persist = debounce({ delay: 300 }, (key: string, value: TabsModel) => {
  json.setItem(key, value);
});

/**
 * localStorage backing for {@link tabsAtom}. The main window shares one origin,
 * so this survives restarts with no main-process round trip. A corrupt/stale
 * blob must not brick the window (AppShell maps over `tabs`), so reads validate
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
    json.removeItem(key);
  },
  setItem: (key: string, value: TabsModel) => {
    persist(key, value);
  },
};

// `getOnInit` so persisted tabs are present on the first render: without it the
// atom would start from a throwaway new-tab and swap after mount, building and
// discarding that tab's router.
export const tabsAtom = atomWithStorage<TabsModel>(
  "studio.tabs.v1",
  freshTabsModel(),
  tabsStorage,
  { getOnInit: true },
);
