import { type WindowTab } from "@/client/atoms/window";
import {
  addressOfTab,
  fileAddressOf,
  sameAddress,
} from "@/client/bookmarks/address";
import { bookmarksAtom } from "@/client/bookmarks/store";
import { type Bookmark } from "@/shared/bookmarks";
import { useAtomValue } from "jotai";

import { segmentsOf } from "../host-path";
import { bareAddress } from "../omnibar-match";
import { useWindowTabs } from "../window-tabs";
import { type Point } from "./landing";
import { STANDING_ID } from "./press-link";
import { dragAtom, useDropTarget } from "./session";
import { outcomeOf } from "./letting-go";
import { type DroppedFile, type Held } from "./types";


/** A bookmark as the bar draws it in a drag: kept, or what is held standing where it would be kept. */
export type ShownBookmark = Bookmark & { isStanding?: true };

/** What a drag knows of the window to say what is held would be kept as. */
interface KeptContext {
  allTabs: readonly WindowTab[];
  bookmarks: readonly Bookmark[];
  /** The tab up on a side of a group, the side with the keyboard unless a half is named. */
  upOf: (group: string, half: 0 | 1 | undefined) => WindowTab | undefined;
  titleOf: (tab: WindowTab) => string;
}

/** An address under a name, as the bookmark it is kept as already, or would be kept as. */
function keptAt(
  { id, title, url }: { id: string; title: string; url: string },
  bookmarks: readonly Bookmark[],
): ShownBookmark {
  const kept = bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
  return kept
    ? { ...kept, isStanding: true }
    : { id, isStanding: true, order: 0, title, url };
}

/** A file or a folder as the address it is kept under, by its name. */
function fileKept({ hostPath, isFolder }: DroppedFile) {
  return {
    title: segmentsOf(hostPath).at(-1) ?? hostPath,
    url: fileAddressOf(hostPath, { isFolder }),
  };
}

/**
 * What is held as the bookmarks it would be kept as: a bookmark as itself;
 * a tab, a whole group's row (the tab up on its half) and each file or
 * folder as the bookmark its address is kept as already, which moves where
 * it is let go, since an address is kept once, else as its address under
 * its name; a link the same, under its name or its address, and while the
 * system's drag has not said where it goes, as a link. Nothing else is kept.
 */
export function keptAs(
  held: Held,
  { allTabs, bookmarks, titleOf, upOf }: KeptContext,
): ShownBookmark[] {
  const ofTab = (tab: WindowTab | undefined) => {
    const url = tab ? addressOfTab(tab) : undefined;
    return tab && url !== undefined
      ? [keptAt({ id: STANDING_ID, title: titleOf(tab), url }, bookmarks)]
      : [];
  };
  switch (held.kind) {
    case "tab": {
      return ofTab(allTabs.find((each) => each.id === held.id));
    }
    case "group": {
      return ofTab(upOf(held.group, held.half));
    }
    case "files": {
      return (held.files ?? []).map((file, index) =>
        keptAt(
          {
            id: held.ids[index] ?? `${STANDING_ID}${String(index)}`,
            ...fileKept(file),
          },
          bookmarks,
        ),
      );
    }
    case "link": {
      if (held.isKept) {
        return [
          {
            id: held.id,
            isStanding: true,
            order: 0,
            title: held.title,
            url: held.url,
          },
        ];
      }
      return [
        keptAt(
          {
            id: held.id,
            title: held.title || (held.url ? bareAddress(held.url) : "Link"),
            url: held.url,
          },
          bookmarks,
        ),
      ];
    }
  }
}

/** What a drag knows of the window, read as it draws. */
function useKeptContext(
  titleOf: (tab: WindowTab) => string,
): Omit<KeptContext, "bookmarks"> {
  const { allTabs, layoutOf } = useWindowTabs();
  return {
    allTabs,
    titleOf,
    upOf: (group, half) => {
      const layout = layoutOf(group);
      const side = layout.sides[half ?? layout.focused];
      return side?.tabs.find((tab) => tab.id === side.up);
    },
  };
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
  const context = useKeptContext(() => "");
  const bookmarks = useAtomValue(bookmarksAtom);
  useDropTarget({
    landingAt: (point, { held }) => {
      const kept = keptAs(held, { ...context, bookmarks });
      if (kept.length === 0) {
        return undefined;
      }
      const element = row();
      const index = element
        ? bookmarkIndexAt(point, element, [
            STANDING_ID,
            ...kept.map((each) => each.id),
          ])
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
  const context = useKeptContext(titleOf);
  if (!drag) {
    return bookmarks;
  }
  const { held, landing } = drag;
  if (landing?.kind === "bookmarks") {
    const kept = keptAs(held, { ...context, bookmarks: all });
    const moving = new Set(kept.map((each) => each.id));
    return kept.length > 0
      ? bookmarks
          .filter((bookmark) => !moving.has(bookmark.id))
          .toSpliced(landing.index, 0, ...kept)
      : bookmarks;
  }
  // Opened somewhere it stays kept here; a bookmark let go where nothing
  // takes it goes from here.
  return held.kind === "link" && outcomeOf(held, landing).does === "remove"
    ? bookmarks.filter((bookmark) => bookmark.id !== held.id)
    : bookmarks;
}
