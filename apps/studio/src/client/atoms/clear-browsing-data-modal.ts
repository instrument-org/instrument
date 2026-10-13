import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the dialog that clears the in-app browser's history, cookies, and
 * cache is open. `<ClearBrowsingDataModal />` at the window root reads it;
 * the page menu, the History menu, and the command menu open it.
 */
export const clearBrowsingDataModalAtom = studioModalAtom<true>();

export function openClearBrowsingData() {
  getDefaultStore().set(clearBrowsingDataModalAtom, true);
}
