import {
  pageAmongHoldsKeyboard,
  registerTabSurface,
} from "@/client/lib/tab-surfaces";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Makes Cmd+T open a tab in this surface while the keyboard is anywhere in
 * `anchor`, and Cmd+W close the tab up while it is in `tabsAnchor`; see
 * tab-surfaces for the whole rule. `closeSurface`, for a surface that is a
 * window of its own, is Cmd+W anywhere else in it. `tabIds` are the
 * surface's tabs, whose pages hold the keyboard from outside it.
 */
export function useTabSurface({
  anchor,
  closeSurface,
  closeTabUp,
  enabled = true,
  openTab,
  tabIds,
  tabsAnchor,
}: {
  anchor: RefObject<Element | null>;
  closeSurface?: () => void;
  closeTabUp: () => boolean;
  enabled?: boolean;
  openTab: () => void;
  tabIds: readonly string[];
  tabsAnchor: RefObject<Element | null>;
}) {
  const latest = useRef({ closeSurface, closeTabUp, openTab, tabIds });
  useEffect(() => {
    latest.current = { closeSurface, closeTabUp, openTab, tabIds };
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerTabSurface({
      anchor: () => anchor.current,
      closeSurface: () => {
        const { closeSurface: close } = latest.current;
        close?.();
        return close !== undefined;
      },
      closeTabUp: () => latest.current.closeTabUp(),
      holdsKeyboard: () => pageAmongHoldsKeyboard(latest.current.tabIds),
      openTab: () => {
        latest.current.openTab();
      },
      tabsAnchor: () => tabsAnchor.current,
    });
  }, [anchor, enabled, tabsAnchor]);
}
