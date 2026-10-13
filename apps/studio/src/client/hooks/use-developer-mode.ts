import { useTabId } from "@/client/hooks/use-active-tab";
import { rpcClient } from "@/client/rpc/client";
import { type TabId } from "@/shared/tabs";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue } from "jotai";

export function useDeveloperMode() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  return preferences?.developerMode ?? false;
}

/**
 * Tabs showing what someone without developer mode sees, while developer mode
 * stays on everywhere else. Held only until the window reloads, since it is
 * for a look at one chat rather than a setting.
 */
export const tabsWithoutDeveloperModeAtom = atom<ReadonlySet<TabId>>(
  new Set<TabId>(),
);

/**
 * Developer mode as the tab this is drawn in shows it: off in a tab it was
 * turned off for. Outside any tab, the floating chat for one, it is the
 * workspace's setting.
 */
export function useTabDeveloperMode() {
  const isDeveloperMode = useDeveloperMode();
  const tabId = useTabId();
  const isOffHere = useAtomValue(tabsWithoutDeveloperModeAtom).has(tabId);
  return isDeveloperMode && !isOffHere;
}
