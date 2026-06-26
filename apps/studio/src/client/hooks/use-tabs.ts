import { tabsAtom } from "@/client/atoms/tabs";
import { type Tab } from "@/shared/tabs";
import { useAtomValue } from "jotai";

export function useTabs(): Tab[] {
  return useAtomValue(tabsAtom).tabs;
}
