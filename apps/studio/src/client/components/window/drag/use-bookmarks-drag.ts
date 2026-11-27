import { type WindowTab } from "@/client/atoms/window";
import {
  addressOfTab,
  fileAddressOf,
  sameAddress,
} from "@/client/bookmarks/address";
import { type DropTarget, moveOps } from "@/client/bookmarks/outline";
import {
  applyBookmarkOpsAtom,
  bookmarksAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import {
  type Bookmark,
  type BookmarkRoot,
  type Bookmarks,
  OTHER_ROOT,
  isWithin,
  siblingsIn,
} from "@/shared/bookmarks";
import { useAtomValue, useSetAtom, useStore } from "jotai";

import { segmentsOf } from "../host-path";
import { bareAddress } from "../omnibar-match";
import { useWindowTabs } from "../window-tabs";
import { holds, type Point } from "./landing";
import { dragAtom, useDropTarget } from "./session";
import { type DroppedFile, type Held, isBookmark, type Landing } from "./types";

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
    case "folder":
    case "rows": {
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

/** What is held as the ids of the bookmarks it moves: a folder itself, and anything else as `keptAs` keeps it. */
function movingOf(held: Held, context: KeptContext): string[] {
  return held.kind === "folder"
    ? [held.folder]
    : keptAs(held, context).map((each) => each.id);
}

/** The index at the end of a folder's or root's bookmarks, counted without those moving. */
function indexAmong(
  state: Bookmarks,
  moving: Iterable<string>,
  folder: string | undefined,
  root?: BookmarkRoot,
) {
  const isMoving = new Set(moving);
  return siblingsIn(state, folder, root).filter(
    (each) => !isMoving.has(each.id),
  ).length;
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
      // A menu open under the bar takes what is held over it, where the
      // bar's slack below it reaches over the menu's first rows.
      if (isOnMenu(point)) {
        return undefined;
      }
      const isOn = (element: HTMLElement | null | undefined) =>
        element?.checkVisibility({ visibilityProperty: true }) === true &&
        holds(element.getBoundingClientRect(), point);
      const element = row();
      const kept = movingOf(held, { ...context, bookmarks: state.bookmarks });
      if (kept.length === 0) {
        return undefined;
      }
      const moving = held.kind === "folder" ? kept : [STANDING_ID, ...kept];
      if (isOn(overflow?.())) {
        const index = indexAmong(state, moving, undefined);
        return { chip: OVERFLOW_CHIP, index, kind: "bookmarks" };
      }
      if (isOn(others?.())) {
        const index = indexAmong(state, moving, undefined, OTHER_ROOT);
        return {
          chip: OTHER_ROOT,
          index,
          kind: "bookmarks",
          root: OTHER_ROOT,
        };
      }
      const folder = element ? folderAt(point, element, moving) : undefined;
      if (folder !== undefined) {
        // Into it, after what is in it already.
        const index = indexAmong(state, moving, folder);
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

/** The open menus under a point, in the order they opened, the last on top. */
function menusAt(point: Point) {
  return [...document.querySelectorAll<HTMLElement>("[role=menu]")].filter(
    (menu) => holds(menu.getBoundingClientRect(), point),
  );
}

/** Whether an open menu is under a point. */
function isOnMenu(point: Point) {
  return menusAt(point).length > 0;
}

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
            const onTop = menusAt(point).at(-1);
            if (!element || onTop !== element) {
              return undefined;
            }
            // A folder goes in no folder inside it, nor in itself.
            if (
              held.kind === "folder" &&
              place.folder !== undefined &&
              isWithin(state, place.folder, held.folder)
            ) {
              return undefined;
            }
            const moving = new Set(
              movingOf(held, { ...context, bookmarks: state.bookmarks }),
            );
            if (moving.size === 0) {
              return undefined;
            }
            const items = [
              ...element.querySelectorAll<HTMLElement>("[data-bookmark-id]"),
            ].filter((item) => !moving.has(item.dataset.bookmarkId ?? ""));
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
              const index = indexAmong(state, moving, into);
              return { folder: into, index, kind: "bookmarks" };
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
 * An outline of bookmarks as a place to land, the Bookmarks page's or the
 * side panel's (its rows drawn in `list` marked `data-outline-row`, in
 * order): what is held lands where the pointer is among the rows
 * (`targetAt`, `dropTargetAt` for the page's rows), before or after a row,
 * or into the folder or root it is over. A bookmark or a folder moves there
 * and anything else is kept there, as on the bar (`keptAs`); rows of the
 * page held together move there and land nowhere else. Over a row that is
 * held, letting go changes nothing. Nothing in a search's flat list.
 */
export function useOutlineTarget({
  isOff,
  list,
  targetAt,
}: {
  isOff: boolean;
  list: () => HTMLElement | null;
  /** Where what is held lands over the row at `index`, `fraction` of the way down it. */
  targetAt: (
    state: Bookmarks,
    index: number,
    fraction: number,
    held: ReadonlySet<string>,
  ) => DropTarget | undefined;
}) {
  const context = useKeptContext(() => "");
  const store = useStore();
  const apply = useSetAtom(applyBookmarkOpsAtom);
  const landingAt = (
    point: Point,
    held: Held,
  ): Landing | "refused" | undefined => {
    const state = store.get(bookmarksStateAtom);
    const ids =
      held.kind === "rows"
        ? held.ids
        : movingOf(held, { ...context, bookmarks: state.bookmarks });
    const elements = [
      ...(list()?.querySelectorAll<HTMLElement>("[data-outline-row]") ?? []),
    ];
    const card = elements[0]?.parentElement?.getBoundingClientRect();
    if (
      ids.length === 0 ||
      !card ||
      point.x < card.left ||
      point.x > card.right
    ) {
      return undefined;
    }
    const index = elements.findIndex((element) => {
      const { bottom, top } = element.getBoundingClientRect();
      return point.y >= top && point.y < bottom;
    });
    const over = elements[index]?.getBoundingClientRect();
    if (!over) {
      return undefined;
    }
    const moving = new Set(ids);
    const target = targetAt(
      state,
      index,
      (point.y - over.top) / over.height,
      moving,
    );
    if (!target) {
      return "refused";
    }
    const { before, folder, root } = target.place;
    const there = siblingsIn(state, folder, root).filter(
      (each) => !moving.has(each.id),
    );
    const at = there.findIndex((each) => each.id === before);
    return {
      ...(folder === undefined ? {} : { folder }),
      index: at === -1 ? there.length : at,
      kind: "bookmarks",
      ...(root === undefined ? {} : { root }),
      row:
        target.kind === "into"
          ? { at: "into", id: target.id }
          : "before" in target.line
            ? { at: "before", id: target.line.before }
            : { at: "after", id: target.line.after },
    };
  };
  // Two targets over the one outline: rows of the page land themselves, as
  // nothing else takes them, and anything else lands as on the bar.
  const targetOver = (isRows: boolean) => ({
    rect: ({ held }: { held: Held }) =>
      (held.kind === "rows") === isRows ? shownRect(list()) : undefined,
    scrolls: { axis: "y" as const, element: list },
  });
  useDropTarget(
    isOff
      ? undefined
      : {
          ...targetOver(false),
          landingAt: (point, { held }) => landingAt(point, held),
        },
  );
  useDropTarget(
    isOff
      ? undefined
      : {
          ...targetOver(true),
          land: (held, landing) => {
            if (held.kind !== "rows" || landing.kind !== "bookmarks") {
              return;
            }
            const state = store.get(bookmarksStateAtom);
            const { folder, root } = landing;
            const before = siblingsIn(state, folder, root).filter(
              (each) => !held.ids.includes(each.id),
            )[landing.index]?.id;
            void apply(
              moveOps(state, held.ids, {
                ...(before === undefined ? {} : { before }),
                ...(folder === undefined ? {} : { folder }),
                ...(root === undefined ? {} : { root }),
              }),
            );
          },
          landingAt: (point, { held }) => landingAt(point, held),
          takesRows: true,
        },
  );
}

/**
 * A place that files what is held at the end of All Bookmarks (`OTHER_ROOT`),
 * as the bar's All Bookmarks chip does, drawn as the row `id` ringed: the
 * side panel's All bookmarks row, and its list while it has none. A
 * bookmark or a folder moves there, and anything else is kept there.
 */
export function useAllBookmarksTarget({
  area,
  id,
}: {
  area: () => HTMLElement | null;
  id: string;
}) {
  const context = useKeptContext(() => "");
  const store = useStore();
  useDropTarget({
    landingAt: (_point, { held }) => {
      const state = store.get(bookmarksStateAtom);
      const kept = movingOf(held, { ...context, bookmarks: state.bookmarks });
      if (kept.length === 0) {
        return undefined;
      }
      const moving = held.kind === "folder" ? kept : [STANDING_ID, ...kept];
      const index = indexAmong(state, moving, undefined, OTHER_ROOT);
      return {
        index,
        kind: "bookmarks",
        root: OTHER_ROOT,
        row: { at: "into", id },
      };
    },
    rect: () => shownRect(area()),
  });
}

/**
 * What an outline of bookmarks draws of a drag: the rows held, which stay
 * dimmed in their places, and the row a landing on it is drawn at.
 */
export function useOutlineDrop(): {
  held: ReadonlySet<string>;
  row: NonNullable<Extract<Landing, { kind: "bookmarks" }>["row"]> | undefined;
} {
  const drag = useAtomValue(dragAtom);
  const held = drag?.held;
  const landing = drag?.landing;
  return {
    held: new Set(
      held?.kind === "rows"
        ? held.ids
        : held?.kind === "folder"
          ? [held.folder]
          : held?.kind === "link" && held.bookmark !== undefined
            ? [held.bookmark]
            : [],
    ),
    row: landing?.kind === "bookmarks" ? landing.row : undefined,
  };
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
  const context = useKeptContext(() => "");
  const landing = drag?.landing;
  if (
    !drag ||
    landing?.kind !== "bookmarks" ||
    landing.folder !== place.folder ||
    landing.root !== place.root ||
    landing.chip !== undefined ||
    landing.row !== undefined
  ) {
    return undefined;
  }
  const { held: what } = drag;
  // What is held as the bookmarks it moves, a tab or link whose address is
  // kept already included, as the landing's index counts without them.
  const held = new Set(
    movingOf(what, { ...context, bookmarks: state.bookmarks }),
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
 * while it would go into a folder or anywhere off the bar, or while the
 * Bookmarks page draws where it goes.
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
    landing.chip !== undefined ||
    landing.row !== undefined
  ) {
    return undefined;
  }
  const { held } = drag;
  const moving = movingOf(held, { ...context, bookmarks: all });
  return { index: landing.index, moving };
}
