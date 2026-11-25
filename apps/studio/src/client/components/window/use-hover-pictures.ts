import { coveringOverlayCountAtom } from "@/client/atoms/guest-coverage";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef } from "react";

import {
  groupPictureKey,
  groupShows,
  hoverPicturesAtom,
  tabPictureKey,
  tabShows,
} from "./hover-pictures";
import { type GroupLayout, groupLayoutOf, type WindowTabs } from "./tab-model";
import { groupOnScreenAtom, windowTabsAtom } from "./window-tabs";

/** What the pointer comes to when it may be about to hover a tab or a group. */
const HOVERED = 'nav[aria-label="Tab groups"], [data-group-tabs]';

/** How long after a tab or a group comes up its first picture is taken. */
const SETTLE_MS = 800;
/** How long a pointer that has not moved may have been somewhere else. */
const AWAY_MS = 1000;
/** How long something has to have been up to be drawn whole. */
const STILL_MS = 400;
/** The keys that begin a chord, and how often one of them takes a picture. */
const MODIFIERS: ReadonlySet<string> = new Set(["Alt", "Control", "Meta"]);
const KEY_EVERY_MS = 2000;
/** How soon a picture something stood in the way of is tried again, and how often. */
const RETRY_MS = 1000;
const RETRIES = 5;

/**
 * What stands over the group on screen and would be in its picture: menus,
 * tooltips and popovers, a toast, or the strip in the middle of a drag.
 */
const OVER =
  "[data-radix-popper-content-wrapper], [data-sonner-toast], [data-side-leaving]";

/** What is up in the window: a group as it is laid out. */
interface Up {
  group: string;
  layout: GroupLayout;
}

/**
 * Keeps small pictures of the groups and tabs this window has had up, for
 * the cards shown on hovering them (`GroupRow`, `TabStrip`). One is taken:
 *
 * - as the pointer comes to the sidebar or a strip, where the next thing it
 *   does may be to leave what is up, and before any card is over it;
 * - as a modifier key goes down, which may begin a chord that leaves it;
 * - and a moment after something comes up, so whatever was seen has one.
 *
 * A frame asked for as something is left can come back showing what came up
 * instead, so one is kept only when what is up never changed between asking
 * for it and getting it, and none is taken of what has only just come up.
 * Nothing is taken while something stands over the group, which keeps the
 * picture it had. The pictures other windows took, and those of an earlier
 * run, are read in as the pointer arrives, so a card has its picture at once.
 */
export function useHoverPictures() {
  const store = useStore();
  useEffect(() => watchForPictures(store), [store]);
  useHousekeeping();
}

/** Takes and reads the pictures of a window; answers what stops it. */
function watchForPictures(store: ReturnType<typeof useStore>) {
  const upNow = (): undefined | Up => {
    const group = store.get(groupOnScreenAtom);
    return group === undefined
      ? undefined
      : { group, layout: groupLayoutOf(store.get(windowTabsAtom), group) };
  };
  // How often what is up has changed, and when it last did.
  let changes = 0;
  let changedAt = Date.now();
  const keep = (
    taken: { at: number; key: string; shows: string; url: string }[],
  ) => {
    if (taken.length > 0) {
      store.set(hoverPicturesAtom, (held) => {
        const next = new Map(held);
        for (const { at, key, shows, url } of taken) {
          if ((next.get(key)?.at ?? 0) < at) {
            next.set(key, { at, shows, url });
          }
        }
        return next;
      });
    }
  };
  let isTaking = false;
  /** Takes what is up, unless something is over it; answers whether it could. */
  const take = (): boolean => {
    if (
      isTaking ||
      Date.now() - changedAt < STILL_MS ||
      document.visibilityState === "hidden" ||
      store.get(coveringOverlayCountAtom) > 0 ||
      document.documentElement.hasAttribute("data-tab-held") ||
      document.querySelector(OVER)
    ) {
      return false;
    }
    const up = upNow();
    const parts = up ? partsOf(up) : [];
    if (parts.length === 0) {
      return false;
    }
    const before = changes;
    isTaking = true;
    void safe(rpcClient.hoverPictures.take.call({ parts })).then(
      async ({ data: id }) => {
        isTaking = false;
        if (id === null || id === undefined || changes !== before) {
          return;
        }
        const { data } = await safe(rpcClient.hoverPictures.keep.call({ id }));
        const shows = new Map(parts.map((each) => [each.key, each.shows]));
        keep(
          (data ?? []).flatMap(({ at, key, url }) => {
            const of = shows.get(key);
            return url === undefined || of === undefined
              ? []
              : [{ at, key, shows: of, url }];
          }),
        );
      },
    );
    return true;
  };
  const read = async () => {
    const held = store.get(hoverPicturesAtom);
    const wanted = wantedOf(store.get(windowTabsAtom)).map((each) => {
      const have = held.get(each.key);
      return have?.shows === each.shows ? { ...each, have: have.at } : each;
    });
    const { data } = await safe(rpcClient.hoverPictures.read.call({ wanted }));
    if (!data) {
      return;
    }
    const shows = new Map(wanted.map((each) => [each.key, each.shows]));
    const found = new Set(data.map(({ key }) => key));
    // What is on hand and not on disk was thrown away, as by clearing
    // browsing data.
    store.set(hoverPicturesAtom, (now) => {
      const next = new Map(now);
      for (const [key, picture] of held) {
        if (!found.has(key) && next.get(key) === picture) {
          next.delete(key);
        }
      }
      return next;
    });
    keep(
      data.flatMap(({ at, key, url }) => {
        const of = shows.get(key);
        return url === undefined || of === undefined
          ? []
          : [{ at, key, shows: of, url }];
      }),
    );
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (delay: number, left: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!take() && left > 0) {
        soon(RETRY_MS, left - 1);
      }
    }, delay);
  };

  let last = upNow();
  const onChange = () => {
    const now = upNow();
    const was = last;
    last = now;
    if (was?.group === now?.group && isEqualUp(was, now)) {
      return;
    }
    changes += 1;
    changedAt = Date.now();
    soon(SETTLE_MS, RETRIES);
  };
  const stops = [
    store.sub(groupOnScreenAtom, onChange),
    store.sub(windowTabsAtom, onChange),
  ];
  soon(SETTLE_MS, RETRIES);

  let keyTakenAt = 0;
  // Where the pointer last moved, and when. One that went over a page sends
  // the window nothing meanwhile, so a pause counts as having been away.
  let hovered: Element | null = null;
  let movedAt = 0;
  const onPointerMove = ({ target }: PointerEvent) => {
    const here = target instanceof Element ? target.closest(HOVERED) : null;
    const isArrival =
      here !== null && (here !== hovered || Date.now() - movedAt > AWAY_MS);
    hovered = here;
    movedAt = Date.now();
    if (isArrival) {
      take();
      void read();
    }
  };
  const onKeyDown = ({ key, repeat }: KeyboardEvent) => {
    if (
      !repeat &&
      MODIFIERS.has(key) &&
      Date.now() - keyTakenAt > KEY_EVERY_MS
    ) {
      keyTakenAt = Date.now();
      take();
    }
  };
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  void read();
  return () => {
    clearTimeout(timer);
    document.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    for (const stop of stops) {
      stop();
    }
  };
}

/** At startup every picture but those of the tabs there are is thrown away, and from then on one goes with its tab or group. */
function useHousekeeping() {
  const store = useStore();
  const { tabs } = useAtomValue(windowTabsAtom);
  const previous = useRef<ReadonlySet<string>>(undefined);
  useEffect(() => {
    const keys = new Set(
      tabs.flatMap((tab) => [
        tabPictureKey(tab.id),
        ...(tab.group === undefined ? [] : [groupPictureKey(tab.group)]),
      ]),
    );
    const before = previous.current;
    if (before === undefined) {
      // An empty window keeps everything: it may not be the tabs yet.
      if (keys.size > 0) {
        previous.current = keys;
        void safe(rpcClient.hoverPictures.keepOnly.call({ keys: [...keys] }));
      }
      return;
    }
    previous.current = keys;
    const gone = [...before].filter((key) => !keys.has(key));
    if (gone.length > 0) {
      store.set(hoverPicturesAtom, (held) => {
        const next = new Map(held);
        for (const key of gone) {
          next.delete(key);
        }
        return next;
      });
      void safe(rpcClient.hoverPictures.forget.call({ keys: gone }));
    }
  }, [store, tabs]);
}

const isEqualUp = (one: undefined | Up, other: undefined | Up) =>
  one === undefined || other === undefined
    ? one === other
    : groupShows(one.layout) === groupShows(other.layout);

/** Every group's and tab's picture there could be. */
function wantedOf(state: WindowTabs) {
  const groups = new Set(
    state.tabs.flatMap(({ group }) => (group === undefined ? [] : [group])),
  );
  return [
    ...[...groups].map((group) => ({
      key: groupPictureKey(group),
      shows: groupShows(groupLayoutOf(state, group)),
    })),
    ...state.tabs.map((tab) => ({
      key: tabPictureKey(tab.id),
      shows: tabShows(tab),
    })),
  ];
}

/**
 * The group drawn now and what each of its sides has up, where they stand in
 * the window. Nothing where the window draws other than `up`.
 */
function partsOf({ group, layout }: Up) {
  const row = document.querySelector("[data-group-up] [data-group-sides]");
  const view = row?.parentElement?.getBoundingClientRect();
  const cards = row ? [...row.querySelectorAll("[data-group-side]")] : [];
  if (
    !row ||
    !view ||
    cards.length !== layout.sides.length ||
    cards.some(
      (card, side) =>
        card.getAttribute("data-tab-up") !== layout.sides[side]?.up,
    )
  ) {
    return [];
  }
  const parts = [
    {
      element: row,
      key: groupPictureKey(group),
      shows: groupShows(layout),
    },
    ...layout.sides.flatMap((side, at) => {
      const tab = side.tabs.find((each) => each.id === side.up);
      const element = cards[at]?.querySelector("[data-side-page]");
      return tab && element
        ? [{ element, key: tabPictureKey(tab.id), shows: tabShows(tab) }]
        : [];
    }),
  ];
  return parts.flatMap(({ element, key, shows }) => {
    const rect = seenOf(element.getBoundingClientRect(), view);
    return rect ? [{ key, rect, shows }] : [];
  });
}

/** What of `box` the row of sides shows, in whole px; a side scrolled mostly out of it has no picture. */
function seenOf(box: DOMRect, view: DOMRect) {
  const x = Math.ceil(Math.max(box.left, view.left, 0));
  const y = Math.ceil(Math.max(box.top, view.top, 0));
  const width = Math.floor(Math.min(box.right, view.right, innerWidth)) - x;
  const height = Math.floor(Math.min(box.bottom, view.bottom, innerHeight)) - y;
  return width < 100 || height < 100 || width < box.width * 0.6
    ? undefined
    : { height, width, x, y };
}
