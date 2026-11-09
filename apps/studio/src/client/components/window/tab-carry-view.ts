import { rpcClient } from "@/client/rpc/client";
import { type TabCarryView, type TabId } from "@/shared/tabs";
import { atom, getDefaultStore } from "jotai";
import { useEffect } from "react";

/**
 * What main has this window's strip show of a tab's drag. A tab held over the
 * strip is only drawn here until it is let go, which is what makes taking it away
 * again cost nothing.
 */
export const tabCarryViewAtom = atom<TabCarryView>({ kind: "row" });

/** Where the tab held over this window's strip stands along it. */
export const tabCarryIndexAtom = atom<number | undefined>(undefined);

export function showTabCarryView(view: TabCarryView) {
  const store = getDefaultStore();
  store.set(tabCarryViewAtom, view);
  if (view.kind !== "incoming") {
    store.set(tabCarryIndexAtom, undefined);
  }
}

async function followTabCarry(signal: AbortSignal) {
  try {
    const views = await rpcClient.window.events.tabCarry.call(undefined, {
      signal,
    });
    for await (const view of views) {
      showTabCarryView(view);
    }
  } catch {
    // The window closing ends the stream.
  }
}

/** Follows what main says the strip shows, for as long as the window is up. */
export function useTabCarryView() {
  useEffect(() => {
    const controller = new AbortController();
    void followTabCarry(controller.signal);
    return () => {
      controller.abort();
    };
  }, []);
}

/**
 * How far past the middle of the tab beside it a held tab goes to take its place,
 * and back to give it up, so a hand at rest on the line does not swap them to and fro.
 */
const TAKES_PLACE_PAST_PX = 8;

/** The tabs a strip draws, with a tab held over it among them. */
export function tabsInView(
  tabs: readonly { id: TabId; pathname: string }[],
  view: TabCarryView,
  index = 0,
): readonly { id: TabId; pathname: string }[] {
  if (view.kind !== "incoming") {
    return tabs;
  }
  const others = tabs.filter((tab) => tab.id !== view.tab.id);
  return [...others.slice(0, index), view.tab, ...others.slice(index)];
}

/**
 * Where the held tab stands over this window's strip, read off the strip as laid
 * out, and told to main, which lands it there.
 */
export function measureCarryIndex(
  view: TabCarryView,
  tabs: readonly { id: TabId }[],
) {
  if (view.kind !== "incoming") {
    return;
  }
  const store = getDefaultStore();
  const index = stripIndexAt(view.clientX - view.pointInTab, tabs, view.tab.id);
  if (store.get(tabCarryIndexAtom) !== index) {
    store.set(tabCarryIndexAtom, index);
    void rpcClient.window.placeTabCarry.call({ index });
  }
}

/**
 * Where a tab with its left edge at a point stands among the tabs other than itself, which are
 * taken where they would stand without it, as the strip lays them out. Layout and
 * not what is drawn, since a tab making way is on its way there, and the answer
 * would move it again.
 */
export function stripIndexAt(
  clientX: number,
  tabs: readonly { id: TabId }[],
  except: TabId,
) {
  const list = document.querySelector<HTMLElement>(
    "[data-app-tab-strip] [role=tablist]",
  );
  if (!list) {
    return 0;
  }
  const { left: listLeft, width: listWidth } = list.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = listWidth / list.offsetWidth;
  const drawn = [...list.querySelectorAll<HTMLElement>("[data-tab-key]")].map(
    (element) => ({
      key: element.dataset.tabKey,
      left: element.offsetLeft - list.offsetLeft,
      width: element.offsetWidth,
    }),
  );
  const heldAt = drawn.findIndex(({ key }) => key === except);
  const held = drawn[heldAt];
  const slot = held
    ? (drawn[heldAt + 1]?.left ?? held.left + held.width) - held.left
    : 0;
  const before = drawn.filter(({ key, left, width }, index) => {
    const standsAt = held && index > heldAt ? left - slot : left;
    const past =
      held && index < heldAt ? -TAKES_PLACE_PAST_PX : TAKES_PLACE_PAST_PX;
    return (
      key !== except &&
      clientX > listLeft + (standsAt + width / 2 + past) * zoom
    );
  });
  const others = tabs.filter((tab) => tab.id !== except);
  const at = others.findIndex((tab) => tab.id === before.at(-1)?.key);
  return at === -1 ? 0 : at + 1;
}
