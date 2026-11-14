import { type WindowTab } from "@/client/atoms/window";
import { addressOfTab, sameAddress } from "@/client/bookmarks/address";
import { bookmarksAtom } from "@/client/bookmarks/store";
import { type Bookmark } from "@/shared/bookmarks";
import { useAtomValue } from "jotai";

import { useWindowTabs } from "../window-tabs";
import { type Point } from "./landing";
import { dragAtom, pressToDrag, useDropTarget } from "./session";
import { type Held } from "./types";

/** The id a tab stands under among the bookmarks while it is held over them. */
const STANDING_ID = ":standing";

/** A bookmark as the bar draws it in a drag: kept, or what is held standing where it would be kept. */
export type ShownBookmark = Bookmark & { isStanding?: true };

/**
 * What is held as the bookmark it would be kept as: a bookmark as itself; a
 * tab as the bookmark its address is kept as already, which moves where it
 * is let go, since an address is kept once; else a tab as its address under
 * its title. Nothing else is kept.
 */
function keptAs(
  held: Held,
  allTabs: readonly WindowTab[],
  bookmarks: readonly Bookmark[],
  titleOf: (tab: WindowTab) => string,
): ShownBookmark | undefined {
  if (held.kind === "bookmark") {
    return {
      id: held.id,
      isStanding: true,
      order: 0,
      title: held.title,
      url: held.url,
    };
  }
  if (held.kind !== "tab") {
    return undefined;
  }
  const tab = allTabs.find((each) => each.id === held.id);
  const url = tab ? addressOfTab(tab) : undefined;
  if (!tab || url === undefined) {
    return undefined;
  }
  const kept = bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
  return kept
    ? { ...kept, isStanding: true }
    : { id: STANDING_ID, isStanding: true, order: 0, title: titleOf(tab), url };
}

/**
 * Where along a row of bookmarks a point stands, among the bookmarks other
 * than what is held, taken where they would stand without it: layout, not
 * what is drawn, so the room made for it never moves the answer.
 */
function bookmarkIndexAt(
  point: Point,
  row: HTMLElement,
  held: readonly string[],
) {
  const bounds = row.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = row.offsetWidth > 0 ? bounds.width / row.offsetWidth : 1;
  const along = (point.x - bounds.left) / zoom;
  const marks = [...row.querySelectorAll<HTMLElement>("[data-bookmark-id]")];
  const startOf = (mark: HTMLElement) => mark.offsetLeft;
  const sizeOf = (mark: HTMLElement) => mark.offsetWidth;
  const isHeld = (mark: HTMLElement) =>
    held.includes(mark.dataset.bookmarkId ?? "");
  const heldAt = marks.findIndex(isHeld);
  const standing = marks[heldAt];
  const next = marks[heldAt + 1];
  const slot = standing
    ? next
      ? startOf(next) - startOf(standing)
      : sizeOf(standing)
    : 0;
  return marks.filter((mark, index) => {
    const start =
      standing && index > heldAt ? startOf(mark) - slot : startOf(mark);
    return !isHeld(mark) && along > start + sizeOf(mark) / 2;
  }).length;
}

function shownRect(element: HTMLElement | null | undefined) {
  if (!element?.checkVisibility({ visibilityProperty: true })) {
    return undefined;
  }
  const { height, left, top, width } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { height, left, top, width } : undefined;
}

/**
 * The bookmarks of the bar as a place to land: a tab held over them is kept
 * there, and a bookmark moves there, a tab's own included when its address
 * is kept already, at the place along them where the pointer is (`row`, its
 * bookmarks marked `data-bookmark-id`; the start where there are none yet).
 */
export function useBookmarksTarget({
  area,
  row,
}: {
  /** Where it takes drops. */
  area: () => HTMLElement | null;
  /** The bookmarks' own row in it, if there are any. */
  row: () => HTMLElement | null;
}) {
  const { allTabs } = useWindowTabs();
  const bookmarks = useAtomValue(bookmarksAtom);
  useDropTarget({
    landingAt: (point, { held }) => {
      const kept = keptAs(held, allTabs, bookmarks, () => "");
      if (!kept) {
        return undefined;
      }
      const element = row();
      const index = element
        ? bookmarkIndexAt(point, element, [STANDING_ID, kept.id])
        : 0;
      return { index, kind: "bookmarks" };
    },
    rect: () => shownRect(area()),
  });
}

/**
 * The bookmarks of the bar as a drag draws them: what is held over them
 * standing where it would be kept, the others making room; and a bookmark
 * held where nothing takes it gone from its place, as letting go there
 * removes it.
 */
export function useShownBookmarks(
  bookmarks: readonly Bookmark[],
  titleOf: (tab: WindowTab) => string,
): readonly ShownBookmark[] {
  const drag = useAtomValue(dragAtom);
  const all = useAtomValue(bookmarksAtom);
  const { allTabs } = useWindowTabs();
  if (!drag) {
    return bookmarks;
  }
  const { held, landing } = drag;
  const kept = keptAs(held, allTabs, all, titleOf);
  const movingId = kept && kept.id !== STANDING_ID ? kept.id : undefined;
  if (landing?.kind === "bookmarks") {
    return kept
      ? bookmarks
          .filter((bookmark) => bookmark.id !== movingId)
          .toSpliced(landing.index, 0, kept)
      : bookmarks;
  }
  // Opened somewhere it stays kept here; a bookmark let go where nothing
  // takes it goes from here.
  return landing === undefined && held.kind === "bookmark"
    ? bookmarks.filter((bookmark) => bookmark.id !== held.id)
    : bookmarks;
}

/**
 * A press on a bookmark, which past the start becomes the bookmark held, by
 * where in it the press was; a press that goes nowhere stays a click.
 */
export function pressBookmark(
  event: React.PointerEvent<HTMLElement>,
  bookmark: Bookmark,
) {
  const element = event.currentTarget;
  const pressedAt = { x: event.clientX, y: event.clientY };
  pressToDrag(event, () => {
    const bounds = element.getBoundingClientRect();
    return {
      grab: { x: pressedAt.x - bounds.left, y: pressedAt.y - bounds.top },
      held: {
        id: bookmark.id,
        kind: "bookmark",
        title: bookmark.title,
        url: bookmark.url,
      },
    };
  });
}
