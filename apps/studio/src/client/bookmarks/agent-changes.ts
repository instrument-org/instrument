import {
  applyBookmarkOps,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type BookmarkPlace,
  type BookmarkRoot,
  type Bookmarks,
  folderOf,
  folderRootOf,
  isWithin,
  orderAfter,
  ordersAt,
  OTHER_ROOT,
  OTHER_ROOT_TITLE,
  parentOf,
  placeOf,
  rootOf,
  siblingsIn,
} from "@/shared/bookmarks";
import {
  type BookmarkChange,
  type BookmarkSide,
  type WindowTabAction,
} from "@instrument-org/workspace/client";
import { isEqual, omit } from "radashi";

import { sameAddress } from "./address";

/**
 * The agent's changes to the bookmarks (`instrument bookmarks`): the ops one
 * comes to, what each did to which bookmark, and the ops that take a turn's
 * back. Every op goes through the window's own store, as the person's do.
 */

type AgentChange = Extract<
  WindowTabAction,
  { kind: "changeBookmarks" }
>["change"];

/** The root as the agent is told it: the bar, or All Bookmarks. */
export function listedRoot(root: BookmarkRoot | undefined): "all" | "bar" {
  return root === OTHER_ROOT ? "all" : "bar";
}

function rootListed(root: "all" | "bar"): BookmarkRoot | undefined {
  return root === "all" ? OTHER_ROOT : undefined;
}

function rootTitle(root: BookmarkRoot | undefined) {
  return root === OTHER_ROOT ? OTHER_ROOT_TITLE : "Bookmarks bar";
}

/**
 * The names of a folder and the folders it is in, outermost first:
 * `Work/Clients` for Clients in Work.
 */
export function folderPath(state: Bookmarks, folder: BookmarkFolder): string {
  const parent = parentOf(state, folder);
  return parent ? `${folderPath(state, parent)}/${folder.title}` : folder.title;
}

/** Every bookmark and folder as a change has it, by id. */
function sidesOf(state: Bookmarks): Map<string, BookmarkSide> {
  const placeWords = (
    root: BookmarkRoot | undefined,
    folder: BookmarkFolder | undefined,
  ) => `${rootTitle(root)}${folder ? `/${folderPath(state, folder)}` : ""}`;
  return new Map([
    ...state.folders.map((each): [string, BookmarkSide] => {
      const parent = parentOf(state, each);
      const root = folderRootOf(state, each.id);
      return [
        each.id,
        {
          kind: "folder",
          order: each.order,
          place: placeWords(root, parent),
          root: listedRoot(root),
          title: each.title,
          ...(parent ? { folder: parent.id } : {}),
        },
      ];
    }),
    ...state.bookmarks.map((bookmark): [string, BookmarkSide] => {
      const folder = folderOf(state, bookmark);
      const root = rootOf(state, bookmark);
      return [
        bookmark.id,
        {
          kind: "bookmark",
          order: bookmark.order,
          place: placeWords(root, folder),
          root: listedRoot(root),
          title: bookmark.title,
          url: bookmark.url,
          ...(folder ? { folder: folder.id } : {}),
        },
      ];
    }),
  ]);
}

/** Whether a bookmark stood alike; the words for its place follow a folder's name, which is the folder's change. */
function sameSide(a: BookmarkSide | undefined, b: BookmarkSide | undefined) {
  return a === undefined || b === undefined
    ? a === b
    : isEqual(omit(a, ["place"]), omit(b, ["place"]));
}

/** What became of each bookmark and folder between two states of them, folders first. */
export function bookmarkChangesBetween(
  from: Bookmarks,
  to: Bookmarks,
): BookmarkChange[] {
  const before = sidesOf(from);
  const after = sidesOf(to);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) =>
    sameSide(before.get(id), after.get(id))
      ? []
      : [
          {
            after: after.get(id) ?? null,
            before: before.get(id) ?? null,
            id,
          },
        ],
  );
}

/** The ops a change the agent asked for comes to, or why it cannot be made. */
export function agentChangeOps(
  state: Bookmarks,
  change: AgentChange,
): { error: string } | { ops: BookmarkOp[] } {
  const bookmark = (id: string) =>
    state.bookmarks.find((each) => each.id === id);
  const folder = (id: string) => state.folders.find((each) => each.id === id);
  const gone = (
    change.type === "newFolder"
      ? []
      : "ids" in change
        ? change.ids
        : [change.id]
  ).find((id) => !bookmark(id) && !folder(id));
  if (gone !== undefined) {
    return { error: `no bookmark or folder has the id "${gone}".` };
  }
  switch (change.type) {
    case "move": {
      return moveOps(state, change);
    }
    case "rename": {
      return folder(change.id) && change.title === ""
        ? { error: "a folder needs a name." }
        : {
            ops: [{ id: change.id, title: change.title, type: "rename" }],
          };
    }
    case "setUrl": {
      if (folder(change.id)) {
        return { error: "that is a folder, which has no address." };
      }
      const kept = state.bookmarks.find(
        (each) => each.id !== change.id && sameAddress(each.url, change.url),
      );
      return kept
        ? {
            error: `that address is bookmarked already, as "${kept.title || kept.url}" (${kept.id}).`,
          }
        : { ops: [{ id: change.id, type: "setUrl", url: change.url }] };
    }
    case "newFolder": {
      if (change.title === "") {
        return { error: "a folder needs a name." };
      }
      const root = rootListed(change.root);
      const into =
        change.folder === undefined ? undefined : folder(change.folder);
      if (change.folder !== undefined && !into) {
        return { error: `no folder has the id "${change.folder}".` };
      }
      const same = state.folders.find(
        (each) =>
          (into
            ? parentOf(state, each)?.id === into.id
            : !parentOf(state, each) &&
              folderRootOf(state, each.id) === root) &&
          each.title.toLowerCase() === change.title.toLowerCase(),
      );
      return same
        ? {
            error: `${into ? `"${into.title}"` : rootTitle(root)} already has a folder "${same.title}" (${same.id}).`,
          }
        : {
            ops: [
              {
                folder: {
                  id: crypto.randomUUID(),
                  order: orderAfter(siblingsIn(state, into?.id, root)),
                  title: change.title,
                  ...(into ? { folder: into.id } : root ? { root } : {}),
                },
                type: "addFolder",
              },
            ],
          };
    }
    case "remove": {
      return { ops: change.ids.map((id) => ({ id, type: "remove" })) };
    }
  }
}

function moveOps(
  state: Bookmarks,
  { after, before, ids, to }: Extract<AgentChange, { type: "move" }>,
): { error: string } | { ops: BookmarkOp[] } {
  const placeOfId = (id: string): BookmarkPlace | undefined => {
    const bookmark = state.bookmarks.find((each) => each.id === id);
    if (bookmark) {
      return placeOf(state, bookmark);
    }
    const folder = state.folders.find((each) => each.id === id);
    if (!folder) {
      return undefined;
    }
    const parent = parentOf(state, folder);
    const root = folderRootOf(state, folder.id);
    return parent ? { folder: parent.id } : root ? { root } : {};
  };
  const anchor = before ?? after;
  const beside = anchor === undefined ? undefined : placeOfId(anchor);
  if (anchor !== undefined && !beside) {
    return { error: `no bookmark or folder has the id "${anchor}".` };
  }
  if (anchor !== undefined && ids.includes(anchor)) {
    return { error: "a bookmark cannot go beside itself." };
  }
  if (
    to !== undefined &&
    to !== "bar" &&
    to !== "all" &&
    !state.folders.some((each) => each.id === to)
  ) {
    return { error: `no folder has the id "${to}".` };
  }
  const named: BookmarkPlace | undefined =
    to === undefined
      ? undefined
      : to === "bar"
        ? {}
        : to === "all"
          ? { root: OTHER_ROOT }
          : { folder: to };
  const place = named ?? beside ?? {};
  if (named && beside && !isEqual(named, beside)) {
    return {
      error: "the one named to go beside is not in that place; leave out --to.",
    };
  }
  const into = place.folder;
  const stuck =
    into === undefined
      ? undefined
      : state.folders.find(
          (each) => ids.includes(each.id) && isWithin(state, into, each.id),
        );
  if (stuck) {
    return {
      error: `the folder "${stuck.title}" cannot go in itself or a folder inside it.`,
    };
  }
  const moved = [...new Set(ids)];
  const there = siblingsIn(state, place.folder, place.root);
  const others = there.filter((each) => !moved.includes(each.id));
  const at = others.findIndex((each) => each.id === anchor);
  const index =
    anchor === undefined ? others.length : before === undefined ? at + 1 : at;
  // Already there, in that order, at that place.
  const wanted = [
    ...others.slice(0, index).map((each) => each.id),
    ...moved,
    ...others.slice(index).map((each) => each.id),
  ];
  if (
    isEqual(
      wanted,
      there.map((each) => each.id),
    )
  ) {
    return { ops: [] };
  }
  const orders = ordersAt(others, index, moved.length, others);
  return {
    ops: moved.map((id, each) => ({
      id,
      order: orders[each] ?? 0,
      type: "move",
      ...place,
    })),
  };
}

/**
 * The ops that put a turn's changes back as they were, skipping each that no
 * longer stands as the turn left it: the person has changed it since, and
 * theirs stands. A folder the turn made goes only once it is empty.
 */
export function undoBookmarkChanges(
  state: Bookmarks,
  changes: readonly BookmarkChange[],
): { ops: BookmarkOp[]; skipped: number; undone: number } {
  const now = sidesOf(state);
  const standing = changes.filter(({ after, id }) =>
    sameSide(now.get(id), after ?? undefined),
  );
  const ops: BookmarkOp[] = [];
  const undone = new Set<string>();
  // Folders back first, for what was filed in them; then what was added,
  // which may have taken the address of one removed; folders made, last.
  const rank = ({ after, before }: BookmarkChange) =>
    before?.kind === "folder" && !after
      ? 0
      : before
        ? 2
        : after?.kind === "folder"
          ? 3
          : 1;
  // How many folders the turn touched each one is in: a removed folder
  // comes back before those inside it, and a folder made goes after them.
  const parentIn = new Map(
    changes.map(({ after, before, id }) => [id, (before ?? after)?.folder]),
  );
  const depth = (id: string) => {
    const seen = new Set([id]);
    let count = 0;
    for (let at = parentIn.get(id); at !== undefined && !seen.has(at);) {
      seen.add(at);
      count += 1;
      at = parentIn.get(at);
    }
    return count;
  };
  const inTurn = (a: BookmarkChange, b: BookmarkChange) =>
    rank(a) - rank(b) ||
    (rank(a) === 3 ? depth(b.id) - depth(a.id) : depth(a.id) - depth(b.id));
  for (const change of standing.toSorted(inTurn)) {
    const so = applyBookmarkOps(state, ops);
    const made = undoOps(so, change);
    if (made) {
      ops.push(...made);
      undone.add(change.id);
    }
  }
  return {
    ops,
    skipped: changes.length - undone.size,
    undone: undone.size,
  };
}

/** The ops one change is put back by, or none where what came since leaves no way to. */
function undoOps(
  state: Bookmarks,
  { after, before, id }: BookmarkChange,
): BookmarkOp[] | undefined {
  if (before === null) {
    const isFull =
      state.bookmarks.some((each) => each.folder === id) ||
      state.folders.some((each) => each.folder === id);
    return isFull ? undefined : [{ id, type: "remove" }];
  }
  const place = {
    ...(before.folder === undefined ? {} : { folder: before.folder }),
    ...(before.root === "all" ? { root: OTHER_ROOT } : {}),
  } satisfies BookmarkPlace;
  const { order, title, url } = before;
  if (after === null) {
    if (before.kind === "folder") {
      const folder: BookmarkFolder = { id, order, title, ...place };
      return [{ folder, type: "addFolder" }];
    }
    const address = url ?? "";
    if (state.bookmarks.some((each) => sameAddress(each.url, address))) {
      return undefined;
    }
    const bookmark: Bookmark = { id, order, title, url: address, ...place };
    return [{ bookmark, type: "add" }];
  }
  const isMoved =
    after.folder !== before.folder ||
    after.root !== before.root ||
    after.order !== order;
  return [
    ...(isMoved ? [{ id, order, type: "move", ...place } as const] : []),
    ...(after.title === title ? [] : [{ id, title, type: "rename" } as const]),
    ...(url === undefined || after.url === url
      ? []
      : [{ id, type: "setUrl", url } as const]),
  ];
}
