import { tabsAtom } from "@/client/atoms/tabs";
import { useAtomValue } from "jotai";

export function useSelectedTab() {
  const { selectedId, tabs } = useAtomValue(tabsAtom);
  if (!selectedId) {
    return;
  }
  return tabs.find((tab) => tab.id === selectedId);
}
