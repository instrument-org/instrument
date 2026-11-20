import {
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type BookmarkPlace,
  type BookmarkRoot,
  type Bookmarks,
  folderOf,
  OTHER_ROOT,
  orderAfter,
  ordersAt,
  placeOf,
  rootItems,
  rootOf,
  siblingsIn,
} from "@/shared/bookmarks";

/**
 * The Bookmarks page as one outline: the bar's items in its order, then
 * All Bookmarks as a row of its own over its items, each folder a row
 * that opens in place over the bookmarks filed in it, and what the page does
 * to the rows picked in it (open, delete, cut, copy, paste, sort, drag),
 * worked out here so the page only draws it.
 */

/**
 * One row of the outline: All Bookmarks, a folder, or a bookmark loose in
 * a root or in a folder. Each is `depth` steps in: the bar's items at none,
 * All Bookmarks' items at one, and a folder's bookmarks one past it.
 */
export type OutlineRow =
  | {
      bookmark: Bookmark;
      depth: number;
      /** The folder it is filed in, which a search names beside it. */
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
 * The rows the page lists: the bar's items in order, each open folder's
 * bookmarks under it, then All Bookmarks, where it has anything, and its
 * items under it while it is open. With search words, every folder and
 * bookmark that has all of them in its name or its address, in that same
 * order, flat, the way a browser's manager searches.
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
  const rowsOf = (root: BookmarkRoot | undefined, depth: number) => {
    const kept = inRoot(root);
    return rootItems(state, root).flatMap((item): OutlineRow[] => {
      if (item.kind === "bookmark") {
        const { bookmark } = item;
        return !isSearch || matches(bookmark.title, bookmark.url)
          ? [{ bookmark, depth, id: bookmark.id, kind: "bookmark", ...kept }]
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
                depth,
                folder,
                id: folder.id,
                isOpen,
                kind: "folder" as const,
              },
            ]
          : []),
        ...inside.map((bookmark) => ({
          bookmark,
          depth: depth + 1,
          folder,
          id: bookmark.id,
          kind: "bookmark" as const,
          ...kept,
        })),
      ];
    });
  };
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
    if (row.kind === "root" || !picked.has(row.id)) {
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
 * asked over that, and at the bar's end with no row. A folder pasted where a
 * folder cannot go, inside another, goes after that folder in its root
 * instead.
 */
export function pastePlace(
  state: Bookmarks,
  row: OutlineRow | undefined,
  hasFolder: boolean,
): Place {
  if (!row) {
    return {};
  }
  if (row.kind === "root") {
    return { root: OTHER_ROOT };
  }
  const root =
    row.kind === "folder" ? row.folder.root : rootOf(state, row.bookmark);
  const inFolder =
    row.kind === "bookmark" ? folderOf(state, row.bookmark)?.id : undefined;
  const container = hasFolder ? undefined : inFolder;
  const anchor = hasFolder && inFolder !== undefined ? inFolder : row.id;
  const siblings = siblingsIn(state, container, root);
  const at = siblings.findIndex((each) => each.id === anchor);
  return { before: siblings[at + 1]?.id, folder: container, ...inRoot(root) };
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
  const into = { ...place, folder };
  const orders = ordersFor(state, into, clip.length, []);
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
            ...filedAt(into),
          },
          type: "add",
        },
      ];
    }
    const id = newId();
    return [
      {
        folder: { id, order, title: item.title, ...inRoot(place.root) },
        type: "addFolder",
      },
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
 * among its own root's items, since folders stay in their root, and a
 * bookmark into a folder or loose into a root. A bookmark whose folder
 * moves with it stays in it. None where a folder would go into a folder or
 * another root, or where nothing moves.
 */
export function moveOps(
  state: Bookmarks,
  ids: readonly string[],
  place: Place,
): BookmarkOp[] {
  const moved = state.folders.filter((folder) => ids.includes(folder.id));
  const folders = new Set(moved.map((folder) => folder.id));
  if (
    moved.length > 0 &&
    (place.folder !== undefined ||
      moved.some((folder) => folder.root !== place.root))
  ) {
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
 * quarter, before or after it in its root, or into it first where it is
 * open; on All Bookmarks, into it at its end, its top quarter being the
 * bar's end and its foot its first place where it is open; and before or
 * after a bookmark by its halves. Nothing over a row that is held, or in a
 * search's flat list.
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
  const containerOf = (each: OutlineRow): BookmarkPlace =>
    each.kind === "bookmark"
      ? placeOf(state, each.bookmark)
      : each.kind === "folder"
        ? inRoot(each.folder.root)
        : {};
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
    const container = containerOf(each);
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
        place: { before: row.id, ...containerOf(row) },
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
      place: { before: row.id, ...containerOf(row) },
    };
  }
  return after(row);
}

/**
 * Sort by name, as a browser's manager sorts a folder: folders first, then
 * bookmarks, each by name the way the person's language orders words; the
 * bar's items and each of its folders', then All Bookmarks' and each of
 * its folders'.
 */
export function sortByNameOps(state: Bookmarks, locale?: string): BookmarkOp[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const byName = (a: { title: string }, b: { title: string }) =>
    collator.compare(a.title, b.title);
  const roots: (BookmarkRoot | undefined)[] = [undefined, OTHER_ROOT];
  const placed = roots.flatMap((root) => {
    const items = rootItems(state, root);
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
        place: inRoot(root),
        was: each.order,
      })),
      ...items.flatMap((item) =>
        item.kind === "folder"
          ? item.items.toSorted(byName).map((bookmark, order) => ({
              id: bookmark.id,
              order,
              place: { folder: item.folder.id },
              was: bookmark.order,
            }))
          : [],
      ),
    ];
  });
  return placed.flatMap(({ id, order, place, was }): BookmarkOp[] =>
    was === order ? [] : [{ id, order, type: "move", ...place }],
  );
}
