import { type WindowTab } from "@/client/atoms/window";
import { addressOfTab } from "@/client/bookmarks/address";
import { type Bookmark, type BookmarkPlace } from "@/shared/bookmarks";
import { useAtomValue } from "jotai";

import { useWindowTabs } from "../window-tabs";
import { type Point } from "./landing";
import { dragAtom, pressToDrag, useDropTarget } from "./session";
import { type Held } from "./types";

/** The id a tab stands under among the bookmarks while it is held over them. */
const STANDING_ID = ":standing";

/** A bookmark as the bar or the sidebar draws it in a drag: kept, or what is held standing where it would be kept. */
export type ShownBookmark = Bookmark & { isStanding?: true };

/** What is held as the bookmark it would be kept as: a bookmark as itself, a tab as its address under its title; nothing else is kept. */
function keptAs(
  held: Held,
  allTabs: readonly WindowTab[],
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
  return tab && url !== undefined
    ? { id: STANDING_ID, isStanding: true, order: 0, title: titleOf(tab), url }
    : undefined;
}

/**
 * Where along a row of bookmarks a point stands, among the bookmarks other
 * than what is held, taken where they would stand without it: layout, not
 * what is drawn, so the room made for it never moves the answer.
 */
function bookmarkIndexAt(
  point: Point,
  row: HTMLElement,
  axis: "x" | "y",
  held: readonly string[],
) {
  const bounds = row.getBoundingClientRect();
  const length = axis === "x" ? row.offsetWidth : row.offsetHeight;
  // On screen px from layout px, which differ by the window's zoom.
  const zoom =
    length > 0 ? (axis === "x" ? bounds.width : bounds.height) / length : 1;
  const along =
    (axis === "x" ? point.x - bounds.left : point.y - bounds.top) / zoom;
  const marks = [...row.querySelectorAll<HTMLElement>("[data-bookmark-id]")];
  const startOf = (mark: HTMLElement) =>
    axis === "x" ? mark.offsetLeft : mark.offsetTop;
  const sizeOf = (mark: HTMLElement) =>
    axis === "x" ? mark.offsetWidth : mark.offsetHeight;
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
 * The bookmarks of the bar or the sidebar as a place to land: a tab held
 * over them is kept there, and a bookmark moves there, at the place along
 * them where the pointer is (`row`, its bookmarks marked `data-bookmark-id`;
 * the start where there are none yet).
 */
export function useBookmarksTarget({
  area,
  axis,
  row,
  where,
}: {
  /** Where it takes drops. */
  area: () => HTMLElement | null;
  axis: "x" | "y";
  /** The bookmarks' own row in it, if there are any. */
  row: () => HTMLElement | null;
  where: BookmarkPlace;
}) {
  const { allTabs } = useWindowTabs();
  useDropTarget({
    landingAt: (point, { held }) => {
      if (!keptAs(held, allTabs, () => "")) {
        return undefined;
      }
      const element = row();
      const index = element
        ? bookmarkIndexAt(point, element, axis, [
            STANDING_ID,
            ...(held.kind === "bookmark" ? [held.id] : []),
          ])
        : 0;
      return { index, kind: "bookmarks", where };
    },
    rect: () => shownRect(area()),
  });
}

/**
 * The bookmarks of the bar or the sidebar as a drag draws them: what is
 * held over them standing where it would be kept, the others making room;
 * and a bookmark of theirs held over the other place's bookmarks, or where
 * nothing takes it, gone from its place, as letting go there moves it or
 * removes it.
 */
export function useShownBookmarks(
  bookmarks: readonly Bookmark[],
  where: BookmarkPlace,
  titleOf: (tab: WindowTab) => string,
): readonly ShownBookmark[] {
  const drag = useAtomValue(dragAtom);
  const { allTabs } = useWindowTabs();
  if (!drag) {
    return bookmarks;
  }
  const { held, landing } = drag;
  const heldId = held.kind === "bookmark" ? held.id : undefined;
  if (landing?.kind === "bookmarks" && landing.where === where) {
    const kept = keptAs(held, allTabs, titleOf);
    return kept
      ? bookmarks
          .filter((bookmark) => bookmark.id !== heldId)
          .toSpliced(landing.index, 0, kept)
      : bookmarks;
  }
  // Opened somewhere it stays kept here; moved to the other place's
  // bookmarks, or let go where nothing takes it, it goes from here.
  const goes = landing === undefined || landing.kind === "bookmarks";
  return goes && heldId !== undefined
    ? bookmarks.filter((bookmark) => bookmark.id !== heldId)
    : bookmarks;
}

/**
 * A press on a bookmark, which past the start becomes the bookmark held, by
 * where in it the press was; a press that goes nowhere stays a click.
 */
export function pressBookmark(
  event: React.PointerEvent<HTMLElement>,
  bookmark: Bookmark,
  where: BookmarkPlace,
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
        where,
      },
    };
  });
}
