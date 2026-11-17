import {
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type Bookmarks,
  barItems,
  folderOf,
  orderAfter,
  ordersAt,
  siblingsIn,
} from "@/shared/bookmarks";

/**
 * The Bookmarks page as one outline: the bar's items in its order, each
 * folder a row that opens in place over the bookmarks filed in it, and what
 * the page does to the rows picked in it (open, delete, cut, copy, paste,
 * sort, drag), worked out here so the page only draws it.
 */

/** One row of the outline: a folder, or a bookmark on the bar or in a folder. */
export type OutlineRow =
  | {
      bookmark: Bookmark;
      /** The folder it is filed in, which a search names beside it. */
      folder?: BookmarkFolder;
      id: string;
      kind: "bookmark";
    }
  | {
      count: number;
      folder: BookmarkFolder;
      id: string;
      isOpen: boolean;
      kind: "folder";
    };

/**
 * The rows the page lists: the bar's items in order, each open folder's
 * bookmarks under it. With search words, every folder and bookmark that has
 * all of them in its name or its address, in that same order, flat, the way
 * a browser's manager searches.
 */
export function outlineRows(
  state: Bookmarks,
  { open, q }: { open: ReadonlySet<string>; q: string },
): OutlineRow[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const isSearch = words.length > 0;
  const matches = (...fields: string[]) => {
    const text = fields.join("\n").toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return barItems(state).flatMap((item): OutlineRow[] => {
    if (item.kind === "bookmark") {
      const { bookmark } = item;
      return !isSearch || matches(bookmark.title, bookmark.url)
        ? [{ bookmark, id: bookmark.id, kind: "bookmark" }]
        : [];
    }
    const { folder, items } = item;
    const isOpen = !isSearch && open.has(folder.id);
    const inside = items.filter(
      (bookmark) =>
        isOpen || (isSearch && matches(bookmark.title, bookmark.url)),
    );
    return [
      ...(!isSearch || matches(folder.title)
        ? [
            {
              count: items.length,
              folder,
              id: folder.id,
              isOpen,
              kind: "folder" as const,
            },
          ]
        : []),
      ...inside.map((bookmark) => ({
        bookmark,
        folder,
        id: bookmark.id,
        kind: "bookmark" as const,
      })),
    ];
  });
}

/** The rows picked, and the one a Shift-click reaches from. */
export interface Selection {
  anchor?: string | undefined;
  ids: ReadonlySet<string>;
}

export const NOTHING_SELECTED: Selection = { ids: new Set() };

/**
 * The rows picked after a click on `id`, as a browser's manager picks them:
 * a click picks that row alone, a ⌘-click adds it or takes it back out, and
 * a Shift-click picks every row from the last one clicked to it. `order` is
 * the rows as listed.
 */
export function selectionAfterClick(
  selection: Selection,
  order: readonly string[],
  id: string,
  { extend = false, toggle = false }: { extend?: boolean; toggle?: boolean },
): Selection {
  if (extend) {
    const anchor =
      selection.anchor !== undefined && order.includes(selection.anchor)
        ? selection.anchor
        : id;
    const from = order.indexOf(anchor);
    const to = order.indexOf(id);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return {
      anchor,
      ids: new Set(toggle ? [...selection.ids, ...range] : range),
    };
  }
  if (toggle) {
    const ids = new Set(selection.ids);
    if (ids.has(id)) {
      ids.delete(id);
    } else {
      ids.add(id);
    }
    return { anchor: id, ids };
  }
  return { anchor: id, ids: new Set([id]) };
}

/**
 * What a change to the rows picked acts on: a folder whole, and a bookmark
 * only where its folder is not picked too, since the folder takes it along.
 */
export function topmostPicked(
  state: Bookmarks,
  ids: ReadonlySet<string>,
): { bookmarks: Bookmark[]; folders: BookmarkFolder[] } {
  return {
    bookmarks: state.bookmarks.filter(
      (bookmark) =>
        ids.has(bookmark.id) && !ids.has(folderOf(state, bookmark)?.id ?? ""),
    ),
    folders: state.folders.filter((folder) => ids.has(folder.id)),
  };
}

/** What Undo puts back after a delete: each folder with every bookmark in it, and each bookmark, as it was. */
export function restoreOps(
  state: Bookmarks,
  removed: { bookmarks: Bookmark[]; folders: BookmarkFolder[] },
): BookmarkOp[] {
  const folderIds = new Set(removed.folders.map((folder) => folder.id));
  return [
    ...removed.folders.map(
      (folder): BookmarkOp => ({ folder, type: "addFolder" }),
    ),
    ...state.bookmarks
      .filter((bookmark) => folderIds.has(bookmark.folder ?? ""))
      .map((bookmark): BookmarkOp => ({ bookmark, type: "add" })),
    ...removed.bookmarks.map(
      (bookmark): BookmarkOp => ({ bookmark, type: "add" }),
    ),
  ];
}

/** A bookmark or a folder as Cut or Copy keeps it to paste: what it is, without where it was. */
export type ClipItem =
  | { kind: "bookmark"; title: string; url: string }
  | {
      items: { title: string; url: string }[];
      kind: "folder";
      title: string;
    };

/** The rows picked as Cut or Copy keeps them, in the outline's order. */
export function clipOf(
  state: Bookmarks,
  rows: readonly OutlineRow[],
  ids: ReadonlySet<string>,
): ClipItem[] {
  const { bookmarks, folders } = topmostPicked(state, ids);
  const picked = new Set([...bookmarks, ...folders].map((each) => each.id));
  return rows.flatMap((row): ClipItem[] => {
    if (!picked.has(row.id)) {
      return [];
    }
    if (row.kind === "bookmark") {
      const { title, url } = row.bookmark;
      return [{ kind: "bookmark", title, url }];
    }
    return [
      {
        items: state.bookmarks
          .filter((bookmark) => bookmark.folder === row.folder.id)
          .map(({ title, url }) => ({ title, url })),
        kind: "folder",
        title: row.folder.title,
      },
    ];
  });
}

/** Where rows go: before an item among the bar's or a folder's (at its end without one). */
export interface Place {
  /** The item it goes before, by id; the end without one. */
  before?: string | undefined;
  /** The folder it goes into, by id; the bar without one. */
  folder?: string | undefined;
}

/**
 * Where a paste goes, as a browser's manager pastes: right after the row it
 * is asked over, among the items beside it, and at the bar's end with no
 * row. A folder pasted where a folder cannot go, inside another, goes after
 * that folder on the bar instead.
 */
export function pastePlace(
  state: Bookmarks,
  row: OutlineRow | undefined,
  hasFolder: boolean,
): Place {
  if (!row) {
    return {};
  }
  const inFolder =
    row.kind === "bookmark" ? folderOf(state, row.bookmark)?.id : undefined;
  const container = hasFolder ? undefined : inFolder;
  const anchor = hasFolder && inFolder !== undefined ? inFolder : row.id;
  const siblings = siblingsIn(state, container);
  const at = siblings.findIndex((each) => each.id === anchor);
  return { before: siblings[at + 1]?.id, folder: container };
}

/** The ops that paste what Copy or Cut kept at a place, each a new bookmark or folder. */
export function pasteOps(
  state: Bookmarks,
  clip: readonly ClipItem[],
  place: Place,
  newId: () => string = () => crypto.randomUUID(),
): BookmarkOp[] {
  const folder = clip.some((item) => item.kind === "folder")
    ? undefined
    : place.folder;
  const orders = ordersFor(state, { ...place, folder }, clip.length, []);
  return clip.flatMap((item, index): BookmarkOp[] => {
    const order = orders[index] ?? 0;
    if (item.kind === "bookmark") {
      return [
        {
          bookmark: {
            id: newId(),
            order,
            title: item.title,
            url: item.url,
            ...(folder === undefined ? {} : { folder }),
          },
          type: "add",
        },
      ];
    }
    const id = newId();
    return [
      { folder: { id, order, title: item.title }, type: "addFolder" },
      ...item.items.map(
        (bookmark, at): BookmarkOp => ({
          bookmark: { folder: id, id: newId(), order: at, ...bookmark },
          type: "add",
        }),
      ),
    ];
  });
}

/**
 * The ops that move rows to a place, in the order given: a folder only
 * among the bar's items, since folders sit on the bar, and a bookmark into
 * a folder or onto the bar. A bookmark whose folder moves with it stays in
 * it. None where a folder would go into a folder, or where nothing moves.
 */
export function moveOps(
  state: Bookmarks,
  ids: readonly string[],
  place: Place,
): BookmarkOp[] {
  const folders = new Set(
    state.folders.filter((folder) => ids.includes(folder.id)).map((f) => f.id),
  );
  if (folders.size > 0 && place.folder !== undefined) {
    return [];
  }
  const moving = ids.filter((id) => {
    const bookmark = state.bookmarks.find((each) => each.id === id);
    return (
      folders.has(id) ||
      (bookmark !== undefined &&
        !folders.has(folderOf(state, bookmark)?.id ?? ""))
    );
  });
  const orders = ordersFor(state, place, moving.length, moving);
  return moving.map((id, index) => ({
    id,
    order: orders[index] ?? 0,
    type: "move",
    ...(place.folder === undefined ? {} : { folder: place.folder }),
  }));
}

/** The orders that sort `count` items, in turn, before `place.before` among what is there, less what moves. */
function ordersFor(
  state: Bookmarks,
  place: Place,
  count: number,
  moving: readonly string[],
): number[] {
  const all = siblingsIn(state, place.folder);
  const there = all.filter((each) => !moving.includes(each.id));
  const at =
    place.before === undefined
      ? there.length
      : there.findIndex((each) => each.id === place.before);
  return at === -1
    ? Array.from({ length: count }, (_, index) => orderAfter(all) + index)
    : ordersAt(there, at, count, all);
}

/**
 * Where rows dragged over a row would land, by how far down it the pointer
 * is (0 at its top, 1 at its foot), the way a browser's manager reads it:
 * on a folder's middle half, into it at its end; on its top or bottom
 * quarter, before or after it on the bar, or into it first where it is
 * open; and before or after a bookmark by its halves. Nothing over a row
 * that is held, or in a search's flat list.
 */
export type DropTarget =
  | {
      kind: "between";
      line: { before: string } | { after: string };
      place: Place;
    }
  | { folder: string; kind: "into" };

export function dropTargetAt(
  state: Bookmarks,
  rows: readonly OutlineRow[],
  index: number,
  fraction: number,
  held: ReadonlySet<string>,
): DropTarget | undefined {
  const row = rows[index];
  if (!row || held.has(row.id)) {
    return undefined;
  }
  const containerOf = (each: OutlineRow) =>
    each.kind === "bookmark" ? folderOf(state, each.bookmark)?.id : undefined;
  const after = (each: OutlineRow): DropTarget => {
    const folder = containerOf(each);
    const siblings = siblingsIn(state, folder).filter(
      (sibling) => !held.has(sibling.id),
    );
    const at = siblings.findIndex((sibling) => sibling.id === each.id);
    return {
      kind: "between",
      line: { after: each.id },
      place: { before: siblings[at + 1]?.id, folder },
    };
  };
  if (row.kind === "folder") {
    if (fraction < 0.25) {
      return {
        kind: "between",
        line: { before: row.id },
        place: { before: row.id },
      };
    }
    if (fraction <= 0.75) {
      return { folder: row.id, kind: "into" };
    }
    if (row.isOpen) {
      const first = siblingsIn(state, row.id).find(
        (sibling) => !held.has(sibling.id),
      );
      return {
        kind: "between",
        line: { after: row.id },
        place: { before: first?.id, folder: row.id },
      };
    }
    return after(row);
  }
  if (fraction < 0.5) {
    return {
      kind: "between",
      line: { before: row.id },
      place: { before: row.id, folder: containerOf(row) },
    };
  }
  return after(row);
}

/**
 * Sort by name, as a browser's manager sorts a folder: folders first, then
 * bookmarks, each by name the way the person's language orders words; the
 * bar's items, then each folder's.
 */
export function sortByNameOps(state: Bookmarks, locale?: string): BookmarkOp[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const byName = (a: { title: string }, b: { title: string }) =>
    collator.compare(a.title, b.title);
  const onBar = barItems(state);
  const sortedBar = [
    ...onBar
      .flatMap((item) => (item.kind === "folder" ? [item.folder] : []))
      .toSorted(byName),
    ...onBar
      .flatMap((item) => (item.kind === "bookmark" ? [item.bookmark] : []))
      .toSorted(byName),
  ];
  const placed: { folder?: string; id: string; order: number; was: number }[] =
    [
      ...sortedBar.map((each, order) => ({
        id: each.id,
        order,
        was: each.order,
      })),
      ...onBar.flatMap((item) =>
        item.kind === "folder"
          ? item.items.toSorted(byName).map((bookmark, order) => ({
              folder: item.folder.id,
              id: bookmark.id,
              order,
              was: bookmark.order,
            }))
          : [],
      ),
    ];
  return placed.flatMap(({ folder, id, order, was }): BookmarkOp[] =>
    was === order
      ? []
      : [
          {
            id,
            order,
            type: "move",
            ...(folder === undefined ? {} : { folder }),
          },
        ],
  );
}
