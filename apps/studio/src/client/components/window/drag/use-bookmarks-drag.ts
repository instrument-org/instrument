import { type WindowTab } from "@/client/atoms/window";
import {
  addressOfTab,
  fileAddressOf,
  sameAddress,
} from "@/client/bookmarks/address";
import { bookmarksAtom, bookmarksStateAtom } from "@/client/bookmarks/store";
import {
  type Bookmark,
  type BookmarkRoot,
  OTHER_ROOT,
  siblingsIn,
} from "@/shared/bookmarks";
import { useAtomValue } from "jotai";

import { segmentsOf } from "../host-path";
import { bareAddress } from "../omnibar-match";
import { useWindowTabs } from "../window-tabs";
import { holds, type Point } from "./landing";
import { dragAtom, useDropTarget } from "./session";
import { type DroppedFile, type Held, isBookmark } from "./types";

/** The id what is held is kept under, where nothing kept stands for it yet. */
const STANDING_ID = ":standing";

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
): Bookmark {
  const kept = bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
  return kept ?? { id, order: 0, title, url };
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
): Bookmark[] {
  const ofTab = (tab: WindowTab | undefined) => {
    const url = tab ? addressOfTab(tab) : undefined;
    return tab && url !== undefined
      ? [keptAt({ id: STANDING_ID, title: titleOf(tab), url }, bookmarks)]
      : [];
  };
  switch (held.kind) {
    case "folder": {
      return [];
    }
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
 * than what is held, which stays in its place while it is held.
 */
function bookmarkIndexAt(
  point: Point,
  row: HTMLElement,
  held: readonly string[],
) {
  const { along, marks } = marksOf(point, row, held);
  return marks.filter(({ size, start }) => along > start + size / 2).length;
}

/**
 * The marks of a row other than what is held, each where it starts, and how
 * far along the row a point is, all in layout px.
 */
function marksOf(point: Point, row: HTMLElement, held: readonly string[]) {
  const bounds = row.getBoundingClientRect();
  // On screen px from layout px, which differ by the window's zoom.
  const zoom = row.offsetWidth > 0 ? bounds.width / row.offsetWidth : 1;
  const along = (point.x - bounds.left) / zoom;
  return { along, marks: marksBesides(row, held) };
}

/** The marks of a row other than what is held, each where it starts and how wide it is, in layout px. */
export function marksBesides(row: HTMLElement, held: readonly string[]) {
  return [...row.querySelectorAll<HTMLElement>("[data-bookmark-id]")]
    .filter((mark) => !held.includes(mark.dataset.bookmarkId ?? ""))
    .map((element) => ({
      element,
      size: element.offsetWidth,
      start: element.offsetLeft,
    }));
}

function shownRect(element: HTMLElement | null | undefined, below = 0) {
  if (!element?.checkVisibility({ visibilityProperty: true })) {
    return undefined;
  }
  const { height, left, top, width } = element.getBoundingClientRect();
  return width > 0 && height > 0
    ? { height: height + below, left, top, width }
    : undefined;
}

/**
 * How far under the bar a bookmark or folder taken from it still moves along it, in
 * the window's px, so a hand drifting off the bar's short height reorders
 * rather than opening it as a tab.
 */
const BAR_SLACK = 28;

/** How long something held rests on a folder before its menu opens, to be filed at a place in it. */
export const SPRING_OPEN_MS = 500;

/** The chevron's chip, past the bar's end, as a bookmarks landing names it (`chip`). */
export const OVERFLOW_CHIP = ":overflow";

/**
 * The bookmarks of the bar as a place to land: a tab held over them is kept
 * there, and a bookmark moves there, a tab's own included when its address
 * is kept already, at the place along them where the pointer is (`row`, its
 * bookmarks marked `data-bookmark-id`; the start where there are none yet).
 * On the chevron (`overflow`) it goes at the bar's end, and on All
 * Bookmarks' chip (`others`) at the end of All Bookmarks; resting on either,
 * or on a folder's chip, opens its menu (`chip`).
 */
export function useBookmarksTarget({
  area,
  others,
  overflow,
  row,
  start,
}: {
  /** Where it takes drops. */
  area: () => HTMLElement | null;
  /** All Bookmarks' chip at the bar's end, where it has any. */
  others?: () => HTMLElement | null;
  /** The chevron over the bookmarks past the row's end, where there are any. */
  overflow?: () => HTMLElement | null;
  /** The bookmarks' own row in it, if there are any. */
  row: () => HTMLElement | null;
  /** Apps, Chats and Files at the bar's start, where a shortcut taken from there lands nowhere. */
  start?: () => HTMLElement | null;
}) {
  const context = useKeptContext(() => "");
  const state = useAtomValue(bookmarksStateAtom);
  useDropTarget({
    landingAt: (point, { held }) => {
      const shortcuts = held.kind === "link" && held.shortcut && start?.();
      if (shortcuts && holds(shortcuts.getBoundingClientRect(), point)) {
        return undefined;
      }
      const isOn = (element: HTMLElement | null | undefined) =>
        element?.checkVisibility({ visibilityProperty: true }) === true &&
        holds(element.getBoundingClientRect(), point);
      const element = row();
      const kept =
        held.kind === "folder"
          ? []
          : keptAs(held, { ...context, bookmarks: state.bookmarks });
      const moving =
        held.kind === "folder"
          ? [held.folder]
          : [STANDING_ID, ...kept.map((each) => each.id)];
      if (held.kind !== "folder" && kept.length === 0) {
        return undefined;
      }
      if (isOn(overflow?.())) {
        const index = siblingsIn(state, undefined).filter(
          (each) => !moving.includes(each.id),
        ).length;
        return { chip: OVERFLOW_CHIP, index, kind: "bookmarks" };
      }
      // A folder stays in its root, so it only moves along the bar.
      if (held.kind !== "folder" && isOn(others?.())) {
        const index = siblingsIn(state, undefined, OTHER_ROOT).filter(
          (each) => !moving.includes(each.id),
        ).length;
        return {
          chip: OTHER_ROOT,
          index,
          kind: "bookmarks",
          root: OTHER_ROOT,
        };
      }
      if (held.kind === "folder") {
        const index = element ? bookmarkIndexAt(point, element, moving) : 0;
        return { index, kind: "bookmarks" };
      }
      const folder = element ? folderAt(point, element, moving) : undefined;
      if (folder !== undefined) {
        // Into it, after what is in it already.
        const index = siblingsIn(state, folder).filter(
          (each) => !moving.includes(each.id),
        ).length;
        return { chip: folder, folder, index, kind: "bookmarks" };
      }
      const index = element ? bookmarkIndexAt(point, element, moving) : 0;
      return { index, kind: "bookmarks" };
    },
    rect: ({ held }) =>
      shownRect(
        area(),
        isBookmark(held) || held.kind === "folder" ? BAR_SLACK : 0,
      ),
  });
}

/**
 * The folder whose chip on the bar a point is well inside of, by id: the
 * middle of a chip files what is held in it, and its ends place it beside.
 */
function folderAt(
  point: Point,
  row: HTMLElement,
  held: readonly string[],
): string | undefined {
  const { along, marks } = marksOf(point, row, held);
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

/** How much of a folder's chip or row, at each end, places what is held beside the folder rather than in it. */
const FOLDER_EDGE = 0.2;

/** Where something is kept: in a folder, or loose in a root, the bar without either. */
type MenuPlace = { folder?: string; root?: BookmarkRoot };

/**
 * A menu of bookmarks as a place to land: a folder's, All Bookmarks', or
 * the chevron's over the bar's end. What is held is filed in `place`
 * before the item under the pointer's lower half, or after the menu's last
 * item, and in a folder whose row's middle the pointer is on (its row
 * marked `data-bookmark-folder`), wherever the menu is on top. Its items, folders' rows included, are
 * marked `data-bookmark-id`. Measured on screen, as the menu draws its
 * items: the item held keeps its place while it is held, so nothing in the
 * menu moves under the pointer. A folder held moves only among the bar's
 * own items, since a folder stays in its root and holds no other.
 */
export function useMenuTarget({
  content,
  place,
}: {
  content: () => HTMLElement | null;
  /** Where the menu's items are kept; nothing while the menu is shut. */
  place: MenuPlace | undefined;
}) {
  const context = useKeptContext(() => "");
  const state = useAtomValue(bookmarksStateAtom);
  useDropTarget(
    place === undefined
      ? undefined
      : {
          landingAt: (point, { held }) => {
            const element = content();
            // Only where the menu is what shows: a submenu drawn over the
            // edge of the menu it opened from takes the pointer there. Open
            // menus are portalled in the order they opened, so the last one
            // under the pointer is on top.
            const onTop = [
              ...document.querySelectorAll<HTMLElement>("[role=menu]"),
            ]
              .filter((menu) => holds(menu.getBoundingClientRect(), point))
              .at(-1);
            if (!element || onTop !== element) {
              return undefined;
            }
            const isBar =
              place.folder === undefined && place.root === undefined;
            if (held.kind === "folder" && !isBar) {
              return undefined;
            }
            const kept =
              held.kind === "folder"
                ? []
                : keptAs(held, { ...context, bookmarks: state.bookmarks });
            if (held.kind !== "folder" && kept.length === 0) {
              return undefined;
            }
            const moving = new Set(
              held.kind === "folder"
                ? [held.folder]
                : kept.map((each) => each.id),
            );
            const items = [
              ...element.querySelectorAll<HTMLElement>("[data-bookmark-id]"),
            ].filter((item) => !moving.has(item.dataset.bookmarkId ?? ""));
            if (held.kind !== "folder") {
              const into = items.find((item) => {
                if (item.dataset.bookmarkFolder === undefined) {
                  return false;
                }
                const rect = item.getBoundingClientRect();
                const edge = rect.height * FOLDER_EDGE;
                return (
                  point.y >= rect.top + edge &&
                  point.y <= rect.bottom - edge &&
                  point.x >= rect.left &&
                  point.x <= rect.right
                );
              })?.dataset.bookmarkFolder;
              if (into !== undefined) {
                const index = siblingsIn(state, into).filter(
                  (each) => !moving.has(each.id),
                ).length;
                return { folder: into, index, kind: "bookmarks" };
              }
            }
            const there = siblingsIn(state, place.folder, place.root).filter(
              (each) => !moving.has(each.id),
            );
            const below = items.find((item) => {
              const rect = item.getBoundingClientRect();
              return point.y <= rect.top + rect.height / 2;
            });
            const last = items.at(-1)?.dataset.bookmarkId;
            const at = (id: string | undefined) =>
              there.findIndex((each) => each.id === id);
            const index = below
              ? at(below.dataset.bookmarkId)
              : last === undefined
                ? there.length
                : at(last) + 1;
            return {
              ...(place.folder === undefined ? {} : { folder: place.folder }),
              index: index === -1 ? there.length : index,
              kind: "bookmarks",
              ...(place.root === undefined ? {} : { root: place.root }),
            };
          },
          rect: () => shownRect(content()),
        },
  );
}

/**
 * Where a drag over a menu of bookmarks would file what is held: before
 * the item named, or after the menu's last item (`"end"`), the menu's
 * items being `items` of what is kept in `place`; nothing while it would
 * go elsewhere, or before an item the menu does not show.
 */
export function useMenuDropLine(
  place: MenuPlace,
  items: readonly string[],
): { before: string; held: ReadonlySet<string> } | undefined {
  const drag = useAtomValue(dragAtom);
  const state = useAtomValue(bookmarksStateAtom);
  const landing = drag?.landing;
  if (
    !drag ||
    landing?.kind !== "bookmarks" ||
    landing.folder !== place.folder ||
    landing.root !== place.root ||
    landing.chip !== undefined
  ) {
    return undefined;
  }
  const { held: what } = drag;
  const held = new Set(
    what.kind === "folder"
      ? [what.folder]
      : what.kind === "link" && what.bookmark !== undefined
        ? [what.bookmark]
        : [],
  );
  const there = siblingsIn(state, place.folder, place.root).filter(
    (each) => !held.has(each.id),
  );
  const before = there[landing.index]?.id;
  if (before !== undefined && items.includes(before)) {
    return { before, held };
  }
  const shown = items.filter((id) => !held.has(id));
  // At the menu's end: after its last item, or in it while it shows none.
  const isEnd =
    shown.length === 0
      ? landing.index >= there.length
      : there[landing.index - 1]?.id === shown.at(-1);
  return isEnd ? { before: "end", held } : undefined;
}

/**
 * Where a drag over the bar would put what is held, for the line the bar
 * draws there: its place among the bar's items other than what is held,
 * and the ids of those, which keep their places while it is held. Nothing
 * while it would go into a folder or anywhere off the bar.
 */
export function useBarDropLine():
  | { index: number; moving: readonly string[] }
  | undefined {
  const drag = useAtomValue(dragAtom);
  const all = useAtomValue(bookmarksAtom);
  const context = useKeptContext(() => "");
  const landing = drag?.landing;
  if (
    !drag ||
    landing?.kind !== "bookmarks" ||
    landing.folder !== undefined ||
    landing.root !== undefined ||
    landing.chip !== undefined
  ) {
    return undefined;
  }
  const { held } = drag;
  const moving =
    held.kind === "folder"
      ? [held.folder]
      : keptAs(held, { ...context, bookmarks: all }).map((each) => each.id);
  return { index: landing.index, moving };
}
