import {
  type BarItem,
  type BookmarkOp,
  type BookmarkPlace,
  type Bookmarks,
  isWithin,
  ordersAt,
  OTHER_ROOT,
  OTHER_ROOT_TITLE,
  rootItems,
  siblingsIn,
} from "@/shared/bookmarks";
import { isInstrumentAddress } from "@instrument-org/shared";
import { omit } from "radashi";
import { z } from "zod";

/** Chrome's ids for its root and the two folders under it, which ours stand in for. */
const CHROME_ROOT_ID = "0";
const CHROME_BAR_ID = "1";
const CHROME_OTHER_ID = "2";

/** A bookmark or folder as `chrome.bookmarks` describes one (`BookmarkTreeNode`). */
export type ChromeBookmark = {
  children?: ChromeBookmark[];
  dateAdded: number;
  dateGroupModified?: number;
  folderType?: "bookmarks-bar" | "other";
  id: string;
  index?: number;
  parentId?: string;
  syncing: false;
  title: string;
  url?: string;
};

/** Chrome's own words for a call it refuses, which extensions may match on. */
const ERRORS = {
  folderNotEmpty: "Can't remove non-empty folder (use recursive to force).",
  index: "Index out of bounds.",
  intoItself: "Can't move a folder into itself or a folder inside it.",
  noNode: "Can't find bookmark for id.",
  noParent: "Can't find parent bookmark for id.",
  notFolder: "Parent must be a folder.",
  recentCount: "numberOfItems cannot be less than 1.",
  root: "Can't modify the root bookmark folders.",
  url: "Invalid URL.",
  urlOfFolder: "Can't set URL of a bookmark folder.",
};

const isRoot = (id: string) =>
  id === CHROME_ROOT_ID || id === CHROME_BAR_ID || id === CHROME_OTHER_ID;

/**
 * Every bookmark as Chrome lays them out: its root (`"0"`) holding the bar
 * (`"1"`) and All Bookmarks (`"2"`, Chrome's "Other bookmarks"), each with
 * its bookmarks and folders in the app's order, a folder's `children` empty
 * when nothing is in it. Ours keep their own ids. `dateOf` is when each was
 * last changed, which stands in for when it was added: nothing records
 * that. A folder's `dateGroupModified` is the newest of what is in it.
 */
export function bookmarkTree(
  state: Bookmarks,
  dateOf: (id: string) => number | undefined,
): ChromeBookmark {
  const known = [...state.bookmarks, ...state.folders].flatMap(
    ({ id }) => dateOf(id) ?? [],
  );
  const oldest = known.length > 0 ? Math.min(...known) : 0;
  const folderOf = (
    node: Omit<ChromeBookmark, "children" | "dateGroupModified" | "syncing">,
    children: ChromeBookmark[],
  ): ChromeBookmark => ({
    ...node,
    children,
    dateGroupModified: Math.max(
      node.dateAdded,
      ...children.map((child) => child.dateGroupModified ?? child.dateAdded),
    ),
    syncing: false,
  });
  const nodesOf = (items: readonly BarItem[], parentId: string) =>
    items.map((item, index): ChromeBookmark => {
      if (item.kind === "bookmark") {
        const { id, title, url } = item.bookmark;
        return {
          dateAdded: dateOf(id) ?? oldest,
          id,
          index,
          parentId,
          syncing: false,
          title,
          url,
        };
      }
      const { id, title } = item.folder;
      return folderOf(
        { dateAdded: dateOf(id) ?? oldest, id, index, parentId, title },
        nodesOf(item.items, id),
      );
    });
  return folderOf({ dateAdded: oldest, id: CHROME_ROOT_ID, title: "" }, [
    folderOf(
      {
        dateAdded: oldest,
        folderType: "bookmarks-bar",
        id: CHROME_BAR_ID,
        index: 0,
        parentId: CHROME_ROOT_ID,
        title: "Bookmarks bar",
      },
      nodesOf(rootItems(state, undefined), CHROME_BAR_ID),
    ),
    folderOf(
      {
        dateAdded: oldest,
        folderType: "other",
        id: CHROME_OTHER_ID,
        index: 1,
        parentId: CHROME_ROOT_ID,
        title: OTHER_ROOT_TITLE,
      },
      nodesOf(rootItems(state, OTHER_ROOT), CHROME_OTHER_ID),
    ),
  ]);
}

/** Every node of a tree, itself first, each before what is in it. */
function nodesIn(node: ChromeBookmark): ChromeBookmark[] {
  return [node, ...(node.children ?? []).flatMap(nodesIn)];
}

/** A node with what is in it, or undefined for an id the tree does not have. */
function nodeOf(tree: ChromeBookmark, id: string): ChromeBookmark | undefined {
  return nodesIn(tree).find((node) => node.id === id);
}

/** A node as `get` and `getChildren` answer it, without what is in it. */
export function withoutChildren(node: ChromeBookmark): ChromeBookmark {
  return omit(node, ["children"]);
}

/** A node that is there, or Chrome's error for an id that is not. */
export function foundNode(tree: ChromeBookmark, id: unknown): ChromeBookmark {
  const node = typeof id === "string" ? nodeOf(tree, id) : undefined;
  if (!node) {
    throw new Error(ERRORS.noNode);
  }
  return node;
}

/** What `chrome.bookmarks.search` takes: words, or fields to match. */
export const BookmarkSearchSchema = z.union([
  z.string(),
  z.object({
    query: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  }),
]);

/**
 * The bookmarks and folders a search matches, in the tree's order: every
 * word of `query` in the title or address, any case, and `title` and `url`
 * exactly. The roots are never among them.
 */
export function searchBookmarks(
  tree: ChromeBookmark,
  search: z.output<typeof BookmarkSearchSchema>,
): ChromeBookmark[] {
  const { query, title, url } =
    typeof search === "string" ? { query: search } : search;
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return nodesIn(tree)
    .filter(
      (node) =>
        !isRoot(node.id) &&
        (title === undefined || node.title === title) &&
        (url === undefined || node.url === url) &&
        words.every((word) =>
          `${node.title} ${node.url ?? ""}`.toLowerCase().includes(word),
        ),
    )
    .map(withoutChildren);
}

/** The `count` bookmarks changed last, newest first, as `getRecent` answers. */
export function recentBookmarks(
  tree: ChromeBookmark,
  count: unknown,
): ChromeBookmark[] {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new Error(ERRORS.recentCount);
  }
  return nodesIn(tree)
    .filter((node) => node.url !== undefined)
    .toSorted((a, b) => b.dateAdded - a.dateAdded)
    .slice(0, count);
}

/** Where an id Chrome names as a parent keeps things: the bar, All Bookmarks, or one of our folders. */
function placeOfParent(state: Bookmarks, parentId: string): BookmarkPlace {
  if (parentId === CHROME_ROOT_ID) {
    throw new Error(ERRORS.root);
  }
  if (parentId === CHROME_BAR_ID) {
    return {};
  }
  if (parentId === CHROME_OTHER_ID) {
    return { root: OTHER_ROOT };
  }
  if (state.folders.some((folder) => folder.id === parentId)) {
    return { folder: parentId };
  }
  if (state.bookmarks.some((bookmark) => bookmark.id === parentId)) {
    throw new Error(ERRORS.notFolder);
  }
  throw new Error(ERRORS.noParent);
}

/** What sits in a place, in order. */
function siblingsOf(state: Bookmarks, place: BookmarkPlace) {
  return siblingsIn(state, place.folder, place.root);
}

function checkedIndex(index: number | undefined, count: number): number {
  if (index === undefined) {
    return count;
  }
  if (index < 0 || index > count) {
    throw new Error(ERRORS.index);
  }
  return index;
}

/** An address as Chrome takes one: any it can read, `""` for none. */
function checkedUrl(url: string | undefined): string | undefined {
  if (url === undefined || url === "") {
    return undefined;
  }
  if (!URL.canParse(url)) {
    throw new Error(ERRORS.url);
  }
  return url;
}

/** What `chrome.bookmarks.create` takes. */
export const CreateDetailsSchema = z.object({
  index: z.number().int().optional(),
  parentId: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

/**
 * The op that makes what `create` asks for under `id`: a bookmark where it
 * has an address and a folder where it has none, in All Bookmarks unless it
 * names a parent, at its `index` or after everything there.
 */
export function createOp(
  state: Bookmarks,
  details: z.output<typeof CreateDetailsSchema>,
  id: string,
): BookmarkOp {
  const place = placeOfParent(state, details.parentId ?? CHROME_OTHER_ID);
  const there = siblingsOf(state, place);
  const index = checkedIndex(details.index, there.length);
  const [order = 0] = ordersAt(there, index, 1, there);
  const url = checkedUrl(details.url);
  const title = details.title ?? "";
  return url === undefined
    ? { folder: { id, order, title, ...place }, type: "addFolder" }
    : { bookmark: { id, order, title, url, ...place }, type: "add" };
}

/** What `chrome.bookmarks.move` takes. */
export const MoveDestinationSchema = z.object({
  index: z.number().int().optional(),
  parentId: z.string().optional(),
});

/**
 * The op that moves a bookmark or folder where `move` asks: into
 * `parentId` (where it is, without one), at `index` (the end, without one),
 * counted as Chrome does among what is there with the one moving still in
 * place. None for a move that leaves it where it is.
 */
export function moveOps(
  state: Bookmarks,
  id: string,
  destination: z.output<typeof MoveDestinationSchema>,
): BookmarkOp[] {
  const tree = bookmarkTree(state, () => 0);
  if (isRoot(id)) {
    throw new Error(ERRORS.root);
  }
  const node = foundNode(tree, id);
  const parentId = destination.parentId ?? node.parentId ?? CHROME_OTHER_ID;
  const place = placeOfParent(state, parentId);
  if (place.folder !== undefined && isWithin(state, place.folder, id)) {
    throw new Error(ERRORS.intoItself);
  }
  const all = siblingsOf(state, place);
  let index = checkedIndex(destination.index, all.length);
  const from = all.findIndex((each) => each.id === id);
  if (from !== -1) {
    if (index === from || index === from + 1) {
      return [];
    }
    if (index > from) {
      index -= 1;
    }
  }
  const there = all.filter((each) => each.id !== id);
  const [order = 0] = ordersAt(there, index, 1, there);
  return [{ id, order, type: "move", ...place }];
}

/** What `chrome.bookmarks.update` takes. */
export const UpdateChangesSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
});

/** The ops that give a bookmark or folder the title and address `update` asks for. */
export function updateOps(
  state: Bookmarks,
  id: string,
  changes: z.output<typeof UpdateChangesSchema>,
): BookmarkOp[] {
  if (isRoot(id)) {
    throw new Error(ERRORS.root);
  }
  const node = foundNode(
    bookmarkTree(state, () => 0),
    id,
  );
  const url = checkedUrl(changes.url);
  if (url !== undefined && node.url === undefined) {
    throw new Error(ERRORS.urlOfFolder);
  }
  return [
    ...(changes.title === undefined
      ? []
      : [{ id, title: changes.title, type: "rename" as const }]),
    ...(url === undefined ? [] : [{ id, type: "setUrl" as const, url }]),
  ];
}

/** The op that removes a bookmark or folder; a folder with anything in it only with `recursive` (`removeTree`). */
export function removeOp(
  state: Bookmarks,
  id: string,
  { recursive }: { recursive: boolean },
): BookmarkOp {
  if (isRoot(id)) {
    throw new Error(ERRORS.root);
  }
  const node = foundNode(
    bookmarkTree(state, () => 0),
    id,
  );
  if (!recursive && (node.children?.length ?? 0) > 0) {
    throw new Error(ERRORS.folderNotEmpty);
  }
  return { id, type: "remove" };
}

/** One event `chrome.bookmarks` tells of a change, its name and arguments. */
export type BookmarkEvent =
  | [name: "bookmarks.onChanged", id: string, { title: string; url?: string }]
  | [name: "bookmarks.onCreated", id: string, ChromeBookmark]
  | [
      name: "bookmarks.onMoved",
      id: string,
      {
        index: number;
        oldIndex: number;
        oldParentId: string;
        parentId: string;
      },
    ]
  | [
      name: "bookmarks.onRemoved",
      id: string,
      { index: number; node: ChromeBookmark; parentId: string },
    ];

/** The bookmarks at one moment, with when each had last changed then. */
export type DatedBookmarks = {
  bookmarks: Bookmarks;
  dateOf: (id: string) => number | undefined;
};

/**
 * The events that tell an extension how `before` became `after`, from
 * wherever the change came, in the tree's order: a folder or bookmark
 * removed, once for a folder with what was in it; each made, a folder
 * before what is in it; each renamed or given a new address; and each
 * moved to another folder or to another place among what is beside it,
 * which an item added or removed beside it is not.
 */
export function bookmarkEvents(
  before: DatedBookmarks,
  after: DatedBookmarks,
): BookmarkEvent[] {
  const was = new Map(
    nodesIn(bookmarkTree(before.bookmarks, before.dateOf)).map((node) => [
      node.id,
      node,
    ]),
  );
  const now = nodesIn(bookmarkTree(after.bookmarks, after.dateOf));
  const nowIds = new Set(now.map((node) => node.id));
  const orderOf = (state: Bookmarks, id: string) =>
    [...state.bookmarks, ...state.folders].find((each) => each.id === id)
      ?.order;
  const events: BookmarkEvent[] = [];
  // Once for the outermost removed, whose node has what was in it.
  for (const node of was.values()) {
    if (!nowIds.has(node.id) && nowIds.has(node.parentId ?? "")) {
      events.push([
        "bookmarks.onRemoved",
        node.id,
        { index: node.index ?? 0, node, parentId: node.parentId ?? "" },
      ]);
    }
  }
  for (const node of now) {
    const old = was.get(node.id);
    if (!old) {
      events.push(["bookmarks.onCreated", node.id, withoutChildren(node)]);
      continue;
    }
    if (old.title !== node.title || old.url !== node.url) {
      events.push([
        "bookmarks.onChanged",
        node.id,
        {
          title: node.title,
          ...(node.url === undefined ? {} : { url: node.url }),
        },
      ]);
    }
    if (
      old.parentId !== node.parentId ||
      orderOf(before.bookmarks, node.id) !== orderOf(after.bookmarks, node.id)
    ) {
      events.push([
        "bookmarks.onMoved",
        node.id,
        {
          index: node.index ?? 0,
          oldIndex: old.index ?? 0,
          oldParentId: old.parentId ?? "",
          parentId: node.parentId ?? "",
        },
      ]);
    }
  }
  return events;
}

/**
 * Whether an address a bookmark can keep is one the app opens itself rather
 * than as a web page: a file or folder (`file://` with no place in a page,
 * or the `instrument://file/` an earlier build kept), a chat, or a built-in
 * page (`instrument://`), as the window reads a bookmark's
 * (`targetOfAddress`).
 */
export function opensInApp(url: string): boolean {
  if (/^file:/i.test(url)) {
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    return parsed === undefined || (parsed.search === "" && parsed.hash === "");
  }
  return isInstrumentAddress(url);
}
