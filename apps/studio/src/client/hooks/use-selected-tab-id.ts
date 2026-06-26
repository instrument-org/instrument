import { tabsAtom } from "@/client/atoms/tabs";
import { useAtomValue } from "jotai";

export function useSelectedTabId() {
  return useAtomValue(tabsAtom).selectedId;
}
