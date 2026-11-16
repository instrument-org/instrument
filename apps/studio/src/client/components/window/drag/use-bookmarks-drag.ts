import { type WindowTab } from "@/client/atoms/window";
import {
  addressOfTab,
  fileAddressOf,
  sameAddress,
} from "@/client/bookmarks/address";
import { bookmarksAtom, bookmarksStateAtom } from "@/client/bookmarks/store";
import {
  type BarItem,
  type Bookmark,
  memberOf,
  siblingsIn,
} from "@/shared/bookmarks";
import { useAtomValue } from "jotai";

import { segmentsOf } from "../host-path";
import { bareAddress } from "../omnibar-match";
import { useWindowTabs } from "../window-tabs";
import { type Point } from "./landing";
import { dragAtom, useDropTarget } from "./session";
import { outcomeOf } from "./letting-go";
import { type DroppedFile, type Held } from "./types";

/** The id what is held stands under among the bookmarks while it is held over them, where nothing kept stands for it. */
const STANDING_ID = ":standing";

/** A bookmark as the bar draws it in a drag: kept, or what is held standing where it would be kept. */
export type ShownBookmark = Bookmark & { isStanding?: true };

/** An item of the bar as it draws it in a drag: a folder, a bookmark kept, or what is held standing where it would be kept. */
export type ShownItem =
  | (Extract<BarItem, { kind: "folder" }> & { isStanding?: undefined })
  | { bookmark: ShownBookmark; isStanding?: true; kind: "bookmark" };

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
      if (held.bookmark !== undefined) {
        return [
          {
            id: held.bookmark,
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
  const { along, marks } = layoutWithout(point, row, held);
  return marks.filter(({ size, start }) => along > start + size / 2).length;
}

/**
 * The marks of a row other than what is held, each where it would start
 * without it, and how far along the row a point is, all in layout px.
 */
function layoutWithout(
  point: Point,
  row: HTMLElement,
  held: readonly string[],
) {
  const bounds = row.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = row.offsetWidth > 0 ? bounds.width / row.offsetWidth : 1;
  const along = (point.x - bounds.left) / zoom;
  const all = [...row.querySelectorAll<HTMLElement>("[data-bookmark-id]")];
  const isHeld = (mark: HTMLElement) =>
    held.includes(mark.dataset.bookmarkId ?? "");
  const heldAt = all.findIndex(isHeld);
  const standing = all[heldAt];
  const next = all[heldAt + 1];
  const slot = standing
    ? next
      ? next.offsetLeft - standing.offsetLeft
      : standing.offsetWidth
    : 0;
  const marks = all.flatMap((element, index) =>
    isHeld(element)
      ? []
      : [
          {
            element,
            size: element.offsetWidth,
            start:
              standing && index > heldAt
                ? element.offsetLeft - slot
                : element.offsetLeft,
          },
        ],
  );
  return { along, marks };
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
  const state = useAtomValue(bookmarksStateAtom);
  useDropTarget({
    landingAt: (point, { held }) => {
      const kept = keptAs(held, { ...context, bookmarks: state.bookmarks });
      if (kept.length === 0) {
        return undefined;
      }
      const element = row();
      const moving = [STANDING_ID, ...kept.map((each) => each.id)];
      const folder = element ? folderAt(point, element, moving) : undefined;
      if (folder !== undefined) {
        // Into it, after what is in it already.
        const index = siblingsIn(state, folder).filter(
          (each) => !moving.includes(each.id),
        ).length;
        return { folder, index, kind: "bookmarks" };
      }
      const index = element ? bookmarkIndexAt(point, element, moving) : 0;
      return { index, kind: "bookmarks" };
    },
    rect: () => shownRect(area()),
  });
}

/**
 * The folder whose chip on the bar a point is well inside of, by id: the
 * middle of a chip files what is held in it, and its ends place it beside.
 * Read where the chips would stand without what is held, as the bar draws
 * them while a folder is lit, so a chip never slides out from under the
 * pointer as the bar makes or takes back room.
 */
function folderAt(
  point: Point,
  row: HTMLElement,
  held: readonly string[],
): string | undefined {
  const { along, marks } = layoutWithout(point, row, held);
  return marks.find(({ element, size, start }) => {
    const edge = size * FOLDER_EDGE;
    return (
      element.dataset.bookmarkFolder !== undefined &&
      element.checkVisibility({ visibilityProperty: true }) &&
      along >= start + edge &&
      along <= start + size - edge
    );
  })?.element.dataset.bookmarkFolder;
}

/** How much of a folder chip's width, at each end, places what is held beside the folder rather than in it. */
const FOLDER_EDGE = 0.2;

/**
 * An open folder's menu as a place to land: what is held is filed in the
 * folder at the place among its items where the pointer is (`content`, its
 * items marked `data-bookmark-id`). Measured on screen, as the menu draws
 * its items: the item held keeps its place while it is held, so nothing in
 * the menu moves under the pointer.
 */
export function useFolderMenuTarget({
  content,
  folder,
}: {
  content: () => HTMLElement | null;
  folder: string | undefined;
}) {
  const context = useKeptContext(() => "");
  const bookmarks = useAtomValue(bookmarksAtom);
  useDropTarget(
    folder === undefined
      ? undefined
      : {
          landingAt: (point, { held }) => {
            const kept = keptAs(held, { ...context, bookmarks });
            const element = content();
            if (kept.length === 0 || !element) {
              return undefined;
            }
            const moving = new Set(kept.map((each) => each.id));
            const index = [
              ...element.querySelectorAll<HTMLElement>("[data-bookmark-id]"),
            ].filter((item) => {
              if (moving.has(item.dataset.bookmarkId ?? "")) {
                return false;
              }
              const rect = item.getBoundingClientRect();
              return point.y > rect.top + rect.height / 2;
            }).length;
            return { folder, index, kind: "bookmarks" };
          },
          rect: () => shownRect(content()),
        },
  );
}

/**
 * Where a drag over an open folder's menu would file what is held: before
 * the item named, or at the end (`"end"`); nothing while it would go
 * elsewhere.
 */
export function useFolderDropLine(
  folder: string,
  items: readonly Bookmark[],
): { before: string; held: ReadonlySet<string> } | undefined {
  const drag = useAtomValue(dragAtom);
  const landing = drag?.landing;
  if (!drag || landing?.kind !== "bookmarks" || landing.folder !== folder) {
    return undefined;
  }
  const held = new Set(
    drag.held.kind === "link" && drag.held.bookmark !== undefined
      ? [drag.held.bookmark]
      : [],
  );
  const there = items.filter((item) => !held.has(item.id));
  return { before: there[landing.index]?.id ?? "end", held };
}

/**
 * The bar's items as a drag draws them: what is held over the bar standing
 * where it would be kept, the others making room; and a bookmark held where
 * nothing takes it gone from its place, as letting go there removes it.
 * Held over a folder, the bar stands as it would without it, the folder lit.
 */
export function useShownBookmarks(
  items: readonly BarItem[],
  titleOf: (tab: WindowTab) => string,
): readonly ShownItem[] {
  const drag = useAtomValue(dragAtom);
  const all = useAtomValue(bookmarksAtom);
  const context = useKeptContext(titleOf);
  if (!drag) {
    return items;
  }
  const { held, landing } = drag;
  if (landing?.kind === "bookmarks") {
    const kept = keptAs(held, { ...context, bookmarks: all });
    const moving = new Set(kept.map((each) => each.id));
    if (landing.folder !== undefined) {
      return items.filter((item) => !moving.has(memberOf(item).id));
    }
    return kept.length > 0
      ? items
          .filter((item) => !moving.has(memberOf(item).id))
          .toSpliced(
            landing.index,
            0,
            ...kept.map(
              (bookmark): ShownItem => ({
                bookmark,
                isStanding: true,
                kind: "bookmark",
              }),
            ),
          )
      : items;
  }
  // Opened somewhere it stays kept here; a bookmark let go where nothing
  // takes it goes from here.
  return held.kind === "link" && outcomeOf(held, landing).does === "remove"
    ? items.filter((item) => memberOf(item).id !== held.bookmark)
    : items;
}
