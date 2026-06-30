import { addTab, emptyTabsModel, type TabsModel } from "@/client/lib/tab-model";
import { tabsStorage } from "@/client/lib/tab-storage";
import { atomWithStorage } from "jotai/utils";

const NEW_TAB_PATH = "/new-tab";

function freshTabsModel(): TabsModel {
  return addTab(emptyTabsModel(), {
    id: crypto.randomUUID(),
    pathname: NEW_TAB_PATH,
  });
}

// `getOnInit` so persisted tabs are present on the first render: without it the
// atom would start from a throwaway new-tab and swap after mount, building and
// discarding that tab's router.
export const tabsAtom = atomWithStorage<TabsModel>(
  "studio.tabs.v1",
  freshTabsModel(),
  tabsStorage,
  { getOnInit: true },
);
