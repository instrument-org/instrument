import { stripIndexAt } from "@/client/components/window/move-tab";
import { rpcClient } from "@/client/rpc/client";
import { type TabCarryView, type TabId } from "@/shared/tabs";
import { atom, getDefaultStore } from "jotai";
import { useEffect } from "react";

/**
 * What this window's strip shows of a tab held by the pointer. The renderer keeps
 * its tabs as they are until the tab is let go, which is what makes going back to
 * the row or Escape cost nothing, so this is only what is drawn meanwhile.
 */
export const tabCarryViewAtom = atom<TabCarryView>({ kind: "row" });

/** Where the tab held over another window's strip stands along it. */
export const tabCarryIndexAtom = atom<number | undefined>(undefined);

export function showTabCarryView(view: TabCarryView) {
  const store = getDefaultStore();
  store.set(tabCarryViewAtom, view);
  if (view.kind !== "joined") {
    store.set(tabCarryIndexAtom, undefined);
  }
}

/** Follows what main says the strip shows, for as long as the window is up. */
export function useTabCarryView() {
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const views = await rpcClient.window.events.tabCarry.call(undefined, {
          signal: controller.signal,
        });
        for await (const view of views) {
          showTabCarryView(view);
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);
}

/** Whether a tab held by the pointer is what this window's strip is showing. */
export function isTabHeldHere(
  view: TabCarryView,
): view is Extract<TabCarryView, { heldId: TabId }> {
  return view.kind === "alone" || view.kind === "joined";
}

/** The tabs a strip draws, as the held tab stands. */
export function tabsInView(
  tabs: readonly { id: TabId; pathname: string }[],
  view: TabCarryView,
  index = 0,
): readonly { id: TabId; pathname: string }[] {
  if (!isTabHeldHere(view)) {
    return tabs;
  }
  const held = tabs.filter((tab) => tab.id === view.heldId);
  if (view.kind === "alone") {
    return held;
  }
  const others = view.tabs.filter((tab) => tab.id !== view.heldId);
  return [...others.slice(0, index), ...held, ...others.slice(index)];
}

/**
 * Where the held tab stands over another window's strip, read off the strip as
 * laid out, and told to main, which lands it there.
 */
export function measureCarryIndex(view: TabCarryView) {
  if (view.kind !== "joined") {
    return;
  }
  const store = getDefaultStore();
  const index = stripIndexAt(view.clientX, view.tabs, view.heldId);
  if (store.get(tabCarryIndexAtom) !== index) {
    store.set(tabCarryIndexAtom, index);
    void rpcClient.window.placeTabDrag.call({ index });
  }
}
