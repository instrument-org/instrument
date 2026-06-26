import { addTab, emptyTabsModel, type TabsModel } from "@/client/lib/tab-model";
import { atom } from "jotai";

const NEW_TAB_PATH = "/new-tab";

function freshId() {
  return crypto.randomUUID();
}

/** Initial state: a single new-tab. (Restart persistence is added in a later stage.) */
function initialModel(): TabsModel {
  return addTab(emptyTabsModel(), { id: freshId(), pathname: NEW_TAB_PATH });
}

export const tabsAtom = atom<TabsModel>(initialModel());
