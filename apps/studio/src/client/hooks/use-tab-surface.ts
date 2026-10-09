import {
  pageAmongHoldsKeyboard,
  registerTabSurface,
} from "@/client/lib/tab-surfaces";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Makes Cmd+T open a tab in this surface while the keyboard is anywhere in
 * `anchor`, and Cmd+W close the tab up while it is in `tabsAnchor`; see
 * tab-surfaces for the whole rule. `tabIds` are the surface's tabs, whose
 * pages hold the keyboard from outside it.
 */
export function useTabSurface({
  anchor,
  closeTabUp,
  enabled = true,
  openTab,
  tabIds,
  tabsAnchor,
}: {
  anchor: RefObject<Element | null>;
  closeTabUp: () => boolean;
  enabled?: boolean;
  openTab: () => void;
  tabIds: readonly string[];
  tabsAnchor: RefObject<Element | null>;
}) {
  const latest = useRef({ closeTabUp, openTab, tabIds });
  useEffect(() => {
    latest.current = { closeTabUp, openTab, tabIds };
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerTabSurface({
      anchor: () => anchor.current,
      closeTabUp: () => latest.current.closeTabUp(),
      holdsKeyboard: () => pageAmongHoldsKeyboard(latest.current.tabIds),
      openTab: () => {
        latest.current.openTab();
      },
      tabsAnchor: () => tabsAnchor.current,
    });
  }, [anchor, enabled, tabsAnchor]);
}
