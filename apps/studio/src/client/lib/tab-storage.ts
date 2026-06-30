import { type TabsModel } from "@/client/lib/tab-model";
import { createJSONStorage } from "jotai/utils";
import { debounce } from "radashi";

const json = createJSONStorage<TabsModel>(() => localStorage);

// Coalesce the burst of writes that navigation/selection produce; persistence is
// best-effort, so a dropped final write on a fast quit is acceptable.
const persist = debounce({ delay: 300 }, (key: string, value: TabsModel) => {
  json.setItem(key, value);
});

/**
 * localStorage backing for {@link tabsAtom} via jotai's `atomWithStorage`. The
 * main window shares one origin, so this survives restarts with no main-process
 * round trip. We don't mirror the full model as a schema -- the versioned key
 * (`studio.tabs.v1`) handles breaking changes -- but a corrupt/stale blob must
 * not brick the window (AppShell maps over `tabs`), so reads fall back to the
 * initial model unless the basic shape holds.
 */
export const tabsStorage = {
  getItem: (key: string, initialValue: TabsModel): TabsModel => {
    const stored = json.getItem(key, initialValue);
    if (!isTabsModel(stored)) {
      return initialValue;
    }
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

function isTabsModel(value: unknown): value is TabsModel {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tabs = (value as Record<string, unknown>).tabs;
  return Array.isArray(tabs) && tabs.length > 0;
}
