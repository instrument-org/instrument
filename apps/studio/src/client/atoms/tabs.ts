import { addTab, emptyTabsModel, type TabsModel } from "@/client/lib/tab-model";
import { loadTabsModel } from "@/client/lib/tab-storage";
import { atom } from "jotai";

const NEW_TAB_PATH = "/new-tab";

function freshId() {
  return crypto.randomUUID();
}

/** Restore persisted tabs, or start with a single new-tab. */
function initialModel(): TabsModel {
  return (
    loadTabsModel() ??
    addTab(emptyTabsModel(), { id: freshId(), pathname: NEW_TAB_PATH })
  );
}

export const tabsAtom = atom<TabsModel>(initialModel());
