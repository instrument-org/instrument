import {
  type BarItem,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type BookmarkPlace,
  type BookmarkRoot,
  type Bookmarks,
  folderOf,
  isWithin,
  itemsOfFolder,
  OTHER_ROOT,
  orderAfter,
  ordersAt,
  parentOf,
  placeOf,
  placeOfFolder,
  rootItems,
  rootOf,
  siblingsIn,
} from "@/shared/bookmarks";

/**
 * The Bookmarks page as one outline: the bar's items in its order, then
 * All Bookmarks as a row of its own over its items, each folder a row
 * that opens in place over the bookmarks and folders in it, and what the page does
 * to the rows picked in it (open, delete, cut, copy, paste, sort, drag),
 * worked out here so the page only draws it.
 */

/**
 * One row of the outline: All Bookmarks, a folder, or a bookmark loose in
 * a root or in a folder. Each is `depth` steps in: the bar's items at none,
 * All Bookmarks' items at one, and what is in a folder one past it.
 */
export type OutlineRow =
  | {
      bookmark: Bookmark;
      depth: number;
      /** The folder it is in, which a search names beside it. */
      folder?: BookmarkFolder;
      id: string;
      kind: "bookmark";
      /** All Bookmarks, where it is in that root, which a search names beside it. */
      root?: BookmarkRoot;
    }
  | {
      count: number;
      depth: number;
      folder: BookmarkFolder;
      id: string;
      isOpen: boolean;
      kind: "folder";
    }
  | {
      /** Every bookmark in it, its folders' included. */
      count: number;
      depth: 0;
      id: typeof OTHER_ROOT;
      isOpen: boolean;
      kind: "root";
    };

/**
 * The rows the page lists: the bar's items in order, what is in each open
 * folder under it, then All Bookmarks, where it has anything, and its
 * items under it while it is open. With search words, every folder and
 * bookmark that has all of them in its name or its address, in that same
 * order, the way a browser's manager searches.
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
  const rowsIn = (
    items: readonly BarItem[],
    depth: number,
    kept: { root?: BookmarkRoot },
    inside: BookmarkFolder | undefined,
  ): OutlineRow[] =>
    items.flatMap((item): OutlineRow[] => {
      if (item.kind === "bookmark") {
        const { bookmark } = item;
        return !isSearch || matches(bookmark.title, bookmark.url)
          ? [
              {
                bookmark,
                depth,
                id: bookmark.id,
                kind: "bookmark",
                ...(inside ? { folder: inside } : {}),
                ...kept,
              },
            ]
          : [];
      }
      const { folder, items: within } = item;
      const isOpen = !isSearch && open.has(folder.id);
      return [
        ...(!isSearch || matches(folder.title)
          ? [
              {
                count: within.length,
                depth,
                folder,
                id: folder.id,
                isOpen,
                kind: "folder" as const,
              },
            ]
          : []),
        ...(isOpen || isSearch ? rowsIn(within, depth + 1, kept, folder) : []),
      ];
    });
  const rowsOf = (root: BookmarkRoot | undefined, depth: number) =>
    rowsIn(rootItems(state, root), depth, inRoot(root), undefined);
  const bar = rowsOf(undefined, 0);
  if (rootItems(state, OTHER_ROOT).length === 0) {
    return bar;
  }
  if (isSearch) {
    return [...bar, ...rowsOf(OTHER_ROOT, 0)];
  }
  const isOpen = open.has(OTHER_ROOT);
  return [
    ...bar,
    {
      count: state.bookmarks.filter(
        (bookmark) => rootOf(state, bookmark) === OTHER_ROOT,
      ).length,
      depth: 0,
      id: OTHER_ROOT,
      isOpen,
      kind: "root",
    },
    ...(isOpen ? rowsOf(OTHER_ROOT, 1) : []),
  ];
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
 * or folder only where no folder it is in is picked too, since that one
 * takes it along.
 */
export function topmostPicked(
  state: Bookmarks,
  ids: ReadonlySet<string>,
): { bookmarks: Bookmark[]; folders: BookmarkFolder[] } {
  const isUnderPicked = (folder: BookmarkFolder | undefined) =>
    folder !== undefined &&
    [...ids].some((id) => isWithin(state, folder.id, id));
  return {
    bookmarks: state.bookmarks.filter(
      (bookmark) =>
        ids.has(bookmark.id) && !isUnderPicked(folderOf(state, bookmark)),
    ),
    folders: state.folders.filter(
      (folder) => ids.has(folder.id) && !isUnderPicked(parentOf(state, folder)),
    ),
  };
}

/**
 * What Undo puts back after a delete: each folder with everything in it,
 * each folder before what is in it, and each bookmark, as it was.
 */
export function restoreOps(
  state: Bookmarks,
  removed: { bookmarks: Bookmark[]; folders: BookmarkFolder[] },
): BookmarkOp[] {
  const opsIn = (items: readonly BarItem[]): BookmarkOp[] =>
    items.flatMap((item): BookmarkOp[] =>
      item.kind === "bookmark"
        ? [{ bookmark: item.bookmark, type: "add" }]
        : [{ folder: item.folder, type: "addFolder" }, ...opsIn(item.items)],
    );
  return [
    ...removed.folders.flatMap((folder): BookmarkOp[] => [
      { folder, type: "addFolder" },
      ...opsIn(itemsOfFolder(state, folder.id)),
    ]),
    ...removed.bookmarks.map(
      (bookmark): BookmarkOp => ({ bookmark, type: "add" }),
    ),
  ];
}

/** A bookmark or a folder as Cut or Copy keeps it to paste: what it is, without where it was. */
export type ClipItem =
  | { kind: "bookmark"; title: string; url: string }
  | { items: ClipItem[]; kind: "folder"; title: string };

/** Every address a kept item has, the ones in its folders included. */
export function addressesOf(item: ClipItem): string[] {
  return item.kind === "bookmark"
    ? [item.url]
    : item.items.flatMap(addressesOf);
}

/** A folder's items as Cut or Copy keeps them. */
function clipIn(items: readonly BarItem[]): ClipItem[] {
  return items.map((item): ClipItem => {
    if (item.kind === "bookmark") {
      const { title, url } = item.bookmark;
      return { kind: "bookmark", title, url };
    }
    return {
      items: clipIn(item.items),
      kind: "folder",
      title: item.folder.title,
    };
  });
}

/** The rows picked as Cut or Copy keeps them, in the outline's order. */
export function clipOf(
  state: Bookmarks,
  rows: readonly OutlineRow[],
  ids: ReadonlySet<string>,
): ClipItem[] {
  const { bookmarks, folders } = topmostPicked(state, ids);
  const picked = new Set([...bookmarks, ...folders].map((each) => each.id));
  return rows.flatMap((row): ClipItem[] => {
    if (row.kind === "root" || !picked.has(row.id)) {
      return [];
    }
    if (row.kind === "bookmark") {
      const { title, url } = row.bookmark;
      return [{ kind: "bookmark", title, url }];
    }
    return [
      {
        items: clipIn(itemsOfFolder(state, row.folder.id)),
        kind: "folder",
        title: row.folder.title,
      },
    ];
  });
}

/**
 * Where rows go: before an item among a root's or a folder's (at its end
 * without one), in the folder named, or loose in the root named (the bar
 * without either).
 */
export interface Place extends BookmarkPlace {
  /** The item it goes before, by id; the end without one. */
  before?: string | undefined;
}

/** A root as a place's own field: none for the bar. */
function inRoot(root: BookmarkRoot | undefined): { root?: BookmarkRoot } {
  return root === undefined ? {} : { root };
}

/** Where a place files a bookmark: in its folder, or loose in its root. */
function filedAt(place: BookmarkPlace): BookmarkPlace {
  return place.folder === undefined
    ? inRoot(place.root)
    : { folder: place.folder };
}

/**
 * Where a paste goes, as a browser's manager pastes: right after the row it
 * is asked over, among the items beside it, at the end of All Bookmarks
 * asked over that, and at the bar's end with no row.
 */
export function pastePlace(
  state: Bookmarks,
  row: OutlineRow | undefined,
): Place {
  if (!row) {
    return {};
  }
  if (row.kind === "root") {
    return { root: OTHER_ROOT };
  }
  const place = containerOf(state, row);
  const siblings = siblingsIn(state, place.folder, place.root);
  const at = siblings.findIndex((each) => each.id === row.id);
  return { before: siblings[at + 1]?.id, ...place };
}

/** Where a row's bookmark or folder is: in a folder, or loose in a root. */
function containerOf(state: Bookmarks, row: OutlineRow): BookmarkPlace {
  return row.kind === "bookmark"
    ? placeOf(state, row.bookmark)
    : row.kind === "folder"
      ? placeOfFolder(state, row.folder)
      : {};
}

/** The ops that paste what Copy or Cut kept at a place, each a new bookmark or folder. */
export function pasteOps(
  state: Bookmarks,
  clip: readonly ClipItem[],
  place: Place,
  newId: () => string = () => crypto.randomUUID(),
): BookmarkOp[] {
  const orders = ordersFor(state, place, clip.length, []);
  const opsOf = (
    item: ClipItem,
    order: number,
    at: BookmarkPlace,
  ): BookmarkOp[] => {
    if (item.kind === "bookmark") {
      return [
        {
          bookmark: {
            id: newId(),
            order,
            title: item.title,
            url: item.url,
            ...filedAt(at),
          },
          type: "add",
        },
      ];
    }
    const id = newId();
    return [
      {
        folder: { id, order, title: item.title, ...filedAt(at) },
        type: "addFolder",
      },
      ...item.items.flatMap((each, index) =>
        opsOf(each, index, { folder: id }),
      ),
    ];
  };
  return clip.flatMap((item, index) => opsOf(item, orders[index] ?? 0, place));
}

/**
 * The ops that move rows to a place, in the order given, into a folder or
 * loose into a root. A bookmark or folder whose folder moves with it stays
 * in it. None where a folder would go into itself or a folder inside it, or
 * where nothing moves.
 */
export function moveOps(
  state: Bookmarks,
  ids: readonly string[],
  place: Place,
): BookmarkOp[] {
  const into = place.folder;
  if (into !== undefined && ids.some((id) => isWithin(state, into, id))) {
    return [];
  }
  const { bookmarks, folders } = topmostPicked(state, new Set(ids));
  const kept = new Set([...bookmarks, ...folders].map((each) => each.id));
  const moving = ids.filter((id) => kept.has(id));
  const orders = ordersFor(state, place, moving.length, moving);
  return moving.map((id, index) => ({
    id,
    order: orders[index] ?? 0,
    type: "move",
    ...filedAt(place),
  }));
}

/** The orders that sort `count` items, in turn, before `place.before` among what is there, less what moves. */
function ordersFor(
  state: Bookmarks,
  place: Place,
  count: number,
  moving: readonly string[],
): number[] {
  const all = siblingsIn(state, place.folder, place.root);
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
 * quarter, before or after it where it is, or into it first where it is
 * open; on All Bookmarks, into it at its end, its top quarter being the
 * bar's end and its foot its first place where it is open; and before or
 * after a bookmark by its halves. Nothing over a row that is held or inside
 * a folder that is, or in a search's list.
 */
export type DropTarget =
  | {
      kind: "between";
      line: { before: string } | { after: string };
      place: Place;
    }
  /** Into the folder or root `id` is the row of, at its end. */
  | { id: string; kind: "into"; place: Place };

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
  // Inside a folder that is held, where nothing held can go.
  const isInHeld = (folder: BookmarkFolder | undefined) =>
    folder !== undefined &&
    [...held].some((id) => isWithin(state, folder.id, id));
  if (
    (row.kind === "folder" && isInHeld(row.folder)) ||
    (row.kind === "bookmark" && isInHeld(folderOf(state, row.bookmark)))
  ) {
    return undefined;
  }
  /** The first place in a folder or a root, where something held goes after its row. */
  const first = (place: BookmarkPlace): DropTarget => ({
    kind: "between",
    line: { after: row.id },
    place: {
      before: siblingsIn(state, place.folder, place.root).find(
        (sibling) => !held.has(sibling.id),
      )?.id,
      ...place,
    },
  });
  const after = (each: OutlineRow): DropTarget => {
    const container = containerOf(state, each);
    const siblings = siblingsIn(state, container.folder, container.root).filter(
      (sibling) => !held.has(sibling.id),
    );
    const at = siblings.findIndex((sibling) => sibling.id === each.id);
    return {
      kind: "between",
      line: { after: each.id },
      place: { before: siblings[at + 1]?.id, ...container },
    };
  };
  if (row.kind === "root") {
    if (fraction < 0.25) {
      return { kind: "between", line: { before: row.id }, place: {} };
    }
    if (row.isOpen && fraction > 0.75) {
      return first({ root: OTHER_ROOT });
    }
    return { id: row.id, kind: "into", place: { root: OTHER_ROOT } };
  }
  if (row.kind === "folder") {
    if (fraction < 0.25) {
      return {
        kind: "between",
        line: { before: row.id },
        place: { before: row.id, ...containerOf(state, row) },
      };
    }
    if (fraction <= 0.75) {
      return { id: row.id, kind: "into", place: { folder: row.id } };
    }
    if (row.isOpen) {
      return first({ folder: row.id });
    }
    return after(row);
  }
  if (fraction < 0.5) {
    return {
      kind: "between",
      line: { before: row.id },
      place: { before: row.id, ...containerOf(state, row) },
    };
  }
  return after(row);
}

/**
 * Sort by name, as a browser's manager sorts a folder: folders first, then
 * bookmarks, each by name the way the person's language orders words; the
 * bar's items and each folder's in it, then All Bookmarks' and each
 * folder's in it.
 */
export function sortByNameOps(state: Bookmarks, locale?: string): BookmarkOp[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const byName = (a: { title: string }, b: { title: string }) =>
    collator.compare(a.title, b.title);
  const sortedIn = (
    items: readonly BarItem[],
    place: BookmarkPlace,
  ): { id: string; order: number; place: BookmarkPlace; was: number }[] => {
    const sorted = [
      ...items
        .flatMap((item) => (item.kind === "folder" ? [item.folder] : []))
        .toSorted(byName),
      ...items
        .flatMap((item) => (item.kind === "bookmark" ? [item.bookmark] : []))
        .toSorted(byName),
    ];
    return [
      ...sorted.map((each, order) => ({
        id: each.id,
        order,
        place,
        was: each.order,
      })),
      ...items.flatMap((item) =>
        item.kind === "folder"
          ? sortedIn(item.items, { folder: item.folder.id })
          : [],
      ),
    ];
  };
  const roots: (BookmarkRoot | undefined)[] = [undefined, OTHER_ROOT];
  const placed = roots.flatMap((root) =>
    sortedIn(rootItems(state, root), inRoot(root)),
  );
  return placed.flatMap(({ id, order, place, was }): BookmarkOp[] =>
    was === order ? [] : [{ id, order, type: "move", ...place }],
  );
}
