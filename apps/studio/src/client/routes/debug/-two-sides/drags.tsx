import { bookmarksAtom } from "@/client/bookmarks/store";
import {
  type Point,
  type Rect,
  sideZoneAt,
  splitTargetsOf,
} from "@/client/components/window/drag/landing";
import { type Drag, dragAtom } from "@/client/components/window/drag/session";
import { type Held } from "@/client/components/window/drag/types";
import {
  type SidebarDrop,
  sidebarDropAt,
  sidebarDropAtom,
} from "@/client/components/window/sidebar-drop";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";

/**
 * Drags held still in a frame: what a drag would show at a moment, set in
 * the frame's own store once its parts are laid out, where the window's
 * drag would set it. The places a drag lands are worked out by the
 * window's own measures (`sideZoneAt`, `sidebarDropAt`) at points in the
 * frame. What the drag layer draws over the window it draws over the frame,
 * so a lit place is given in the frame's px; a tab standing in a strip
 * stands at a point on screen, with the pointer at the window's corner
 * (`dragPoint`, set by the page), so it is given by how far left of that
 * corner it stands.
 */

type Store = ReturnType<typeof useStore>;

/** What a scene works in: the frame's parts where they are, and the drag to show. */
export interface Stage {
  /** The first bookmark on the bar, held: the workspace's own, or one made up where it keeps none. */
  barBookmark: () => Held;
  /** An element of the frame. */
  find: (selector: string) => HTMLElement | null;
  /** Where the frame is on screen. */
  frame: () => Rect;
  /** Where an element of the frame is on screen. */
  rectOf: (selector: string) => Rect | undefined;
  /** A rect on screen as the frame's own, where the drag layer draws over it. */
  rel: (rect: Rect) => Rect;
  /** Shows a drag, and where it would land in the sidebar, then waits for it to be drawn. */
  show: (drag: Drag | undefined, drop?: SidebarDrop) => Promise<void>;
  /** A point on screen as the grab that stands what goes with the pointer there in the frame. */
  grabAt: (point: Point) => Point;
}

export type Scene = (stage: Stage) => Promise<void>;

function nextFrames(count: number) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => {
        step(left - 1);
      });
    };
    step(count);
  });
}

function rectOfElement(element: Element | null): Rect | undefined {
  if (!element) {
    return undefined;
  }
  const { height, left, top, width } = element.getBoundingClientRect();
  return { height, left, top, width };
}

function stageOf(
  frame: HTMLElement,
  store: Store,
  isCurrent: () => boolean,
): Stage {
  const find = (selector: string) => frame.querySelector<HTMLElement>(selector);
  const corner = () => frame.getBoundingClientRect();
  return {
    barBookmark: () => barBookmark(store),
    find,
    frame: () => {
      const { height, left, top, width } = corner();
      return { height, left, top, width };
    },
    grabAt: (point) => {
      const { left, top } = corner();
      return { x: -(point.x - left), y: -(point.y - top) };
    },
    rectOf: (selector) => rectOfElement(find(selector)),
    rel: (rect) => {
      const { left, top } = corner();
      return { ...rect, left: rect.left - left, top: rect.top - top };
    },
    show: async (drag, drop) => {
      if (!isCurrent()) {
        return;
      }
      store.set(dragAtom, drag);
      store.set(sidebarDropAtom, drop);
      await nextFrames(2);
    },
  };
}

/**
 * Plays a scene once the frame it is in is laid out, and again as the
 * window changes size, since a tab standing in a strip stands at a point on
 * screen. Only the latest play shows anything, so plays that overlap leave
 * the last one's drag.
 */
export function Freeze({ scene }: { scene: Scene }) {
  const store = useStore();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let isLive = true;
    let plays = 0;
    const play = async () => {
      plays += 1;
      const mine = plays;
      const isCurrent = () => isLive && mine === plays;
      await nextFrames(3);
      const frame = ref.current?.closest<HTMLElement>("[data-picture]");
      if (frame && isCurrent()) {
        await scene(stageOf(frame, store, isCurrent));
      }
    };
    void play();
    const replay = () => {
      void play();
    };
    window.addEventListener("resize", replay);
    return () => {
      isLive = false;
      window.removeEventListener("resize", replay);
    };
  }, [scene, store]);
  return <span hidden ref={ref} />;
}

/** A group's tab, held. */
export function heldTab(group: string, id: string, side: 0 | 1 = 0): Held {
  return { group, id, key: id, kind: "tab", side };
}

/** Files dragged in from outside the app, held: a document and a folder. */
export const HELD_FILES: Held = {
  count: 2,
  files: [
    { hostPath: "/Users/mac-user/Documents/Roof quote.pdf", isFolder: false },
    { hostPath: "/Users/mac-user/Pictures/Roof photos", isFolder: true },
  ],
  ids: ["held-file-quote", "held-file-photos"],
  kind: "files",
};

const AT_REST: Pick<Drag, "input" | "isOff"> = {
  input: "pointer",
  isOff: false,
};

/**
 * What is held standing in a side's strip at a place, the others making
 * room: stood a little right of the place it takes, as a hand holds it.
 * Where it stands is measured from its place in the row as it is: shown
 * once from there, its place is the room it opened, and it is stood again
 * by that, so a scene played again stands it there from the start.
 */
export function inStrip({
  group,
  held,
  index,
  input = "pointer",
  side,
}: {
  group: string;
  held: Held;
  index: number;
  input?: Drag["input"];
  side: 0 | 1;
}): Scene {
  const key =
    held.kind === "tab"
      ? held.key
      : held.kind === "files"
        ? held.ids[0]
        : held.kind === "bookmark"
          ? held.id
          : undefined;
  return async (stage) => {
    const standsAt = () => {
      const element = stage.find(
        `[data-group-side="${String(side)}"] [data-tab-key="${key ?? ""}"]`,
      );
      const list = element?.closest<HTMLElement>("[role=tablist]");
      if (!element || !list) {
        return 0;
      }
      const bounds = list.getBoundingClientRect();
      const zoom = bounds.width / (list.offsetWidth || 1);
      return bounds.left + (element.offsetLeft - list.offsetLeft + 18) * zoom;
    };
    const show = (at: number) =>
      stage.show({
        grab: { x: -at, y: 0 },
        held,
        input,
        isOff: false,
        landing: { group, index, kind: "strip", side },
      });
    await show(standsAt());
    await show(standsAt());
  };
}

/**
 * What is held over a side's page, at a share of its width: the half a
 * lone side's end would make a side lit, or the side it would join, or
 * nothing, as over its own side's middle; and a lone side's ends shown
 * faintly, as from the drag's start, the end lit giving way to its half.
 */
export function overSide({
  across,
  group,
  held,
  heldIn = {},
  input = "pointer",
  side,
}: {
  /** How far across the side's page the pointer is, 0 to 1. */
  across: number;
  group: string;
  held: Held;
  /** Where what is held stands in this group, as `sideZoneAt` reads it. */
  heldIn?: { isAlone?: boolean; side?: 0 | 1 };
  input?: Drag["input"];
  side: 0 | 1;
}): Scene {
  return async (stage) => {
    const sides = [0, 1].flatMap((each) => {
      const rect = stage.rectOf(`[data-side-page="${String(each)}"]`);
      return rect ? [rect] : [];
    });
    const page = sides[side];
    if (!page) {
      return;
    }
    const point = {
      x: page.left + page.width * across,
      y: page.top + page.height / 2,
    };
    const zone = sideZoneAt({ held: heldIn, point, sides });
    await stage.show({
      // Where nothing on the page takes it, what is held goes with the pointer.
      grab: stage.grabAt(point),
      held,
      hints: splitTargetsOf({ held: heldIn, sides }).map((target) => ({
        ...target,
        page: stage.rel(target.page),
      })),
      input,
      isOff: false,
      landing: zone
        ? {
            group,
            kind: "side",
            lit: stage.rel(zone.lit),
            side: zone.side,
            split: zone.kind === "split",
          }
        : undefined,
    });
  };
}

/** Files held over a new tab, which turns into them: the page lit whole. */
export function overNewTab({
  group,
  tab,
}: {
  group: string;
  tab: string;
}): Scene {
  return async (stage) => {
    const page = stage.rectOf('[data-side-page="0"]');
    if (!page) {
      return;
    }
    await stage.show({
      grab: { x: 0, y: 0 },
      held: HELD_FILES,
      input: "native",
      isOff: false,
      landing: { group, kind: "newTab", lit: stage.rel(page), tab },
    });
  };
}

/**
 * A tab held over a sidebar row: over its middle it joins the row's group,
 * which lights; near its top edge a room opens in front of it, where the
 * tab stands as the group it would make.
 */
export function overRow({
  held,
  how,
  row,
}: {
  held: Held;
  how: "between" | "into";
  row: string;
}): Scene {
  return async (stage) => {
    const rect = stage.rectOf(`[data-group-row="${row}"]`);
    if (!rect) {
      return;
    }
    const x = rect.left + rect.width / 2;
    const y = how === "into" ? rect.top + rect.height / 2 : rect.top + 2;
    const { drop } = sidebarDropAt(x, y, {
      carries: "tab",
      from: held.kind === "tab" ? held.group : undefined,
    });
    await stage.show(
      {
        ...AT_REST,
        grab: { x: 0, y: 0 },
        held,
        landing: drop ? { drop, kind: "sidebar" } : undefined,
      },
      drop,
    );
  };
}

/**
 * A whole group held by its row and carried down the list: its place shut,
 * a room open in front of another row, and the row held over the list.
 */
export function rowHeld({
  group,
  over,
}: {
  group: string;
  /** The row the room opens in front of. */
  over: string;
}): Scene {
  return async (stage) => {
    const item = stage
      .find(`[data-group-row="${group}"]`)
      ?.closest<HTMLElement>("[data-drop-item]");
    const height = (item?.offsetHeight ?? 52) + 2;
    const held: Held = { group, height, kind: "group" };
    await stage.show({
      ...AT_REST,
      grab: { x: 0, y: 0 },
      held,
      landing: undefined,
    });
    const target = stage.rectOf(`[data-group-row="${over}"]`);
    if (!target) {
      return;
    }
    const point = { x: target.left + 40, y: target.top - 6 };
    const { drop } = sidebarDropAt(target.left + target.width / 2, point.y, {
      carries: "group",
      gap: height,
    });
    await stage.show(
      {
        ...AT_REST,
        grab: { x: -(point.x - target.left), y: stage.grabAt(point).y },
        held,
        landing: drop ? { drop, kind: "sidebar" } : undefined,
      },
      drop,
    );
  };
}

/** A tab or a bookmark held over the bookmarks bar, standing where it would be kept. */
export function onBar({ held, index }: { held: Held; index: number }): Scene {
  return async (stage) => {
    await stage.show({
      ...AT_REST,
      grab: { x: 0, y: 0 },
      held,
      landing: { index, kind: "bookmarks" },
    });
  };
}

function barBookmark(store: Store): Held {
  const [kept] = store.get(bookmarksAtom);
  return kept
    ? {
        id: kept.id,
        kind: "bookmark",
        title: kept.title,
        url: kept.url,
      }
    : {
        id: "held-bookmark",
        kind: "bookmark",
        title: "Zendesk pricing",
        url: "https://www.zendesk.com/pricing/",
      };
}

/** A bookmark of the bar held along it, to stand at a place further on. */
export function bookmarkAlong(index: number): Scene {
  return async (stage) => {
    await onBar({ held: stage.barBookmark(), index })(stage);
  };
}

/**
 * Something held where nothing in the window takes it: what goes with the
 * pointer stands at a point a share across and down the frame. Past every
 * edge of the window, nothing goes with it here at all.
 */
export function nowhere({
  at,
  held,
  isOff = false,
}: {
  /** Where the pointer is, as shares of the frame's width and height. */
  at: { x: number; y: number };
  held: Held | "bar bookmark";
  isOff?: boolean;
}): Scene {
  return async (stage) => {
    const box = stage.frame();
    const point = {
      x: box.left + box.width * at.x,
      y: box.top + box.height * at.y,
    };
    await stage.show({
      grab: stage.grabAt(point),
      held: held === "bar bookmark" ? stage.barBookmark() : held,
      input: "pointer",
      isOff,
      landing: undefined,
    });
  };
}
