import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import nodePath from "node:path";
import { z } from "zod";

import {
  BOOKMARKS_ARE_THE_CHATS,
  BOOKMARKS_COMMAND,
  BOOKMARKS_NEED_A_TURN,
  BOOKMARKS_READ_WAIT_MS,
} from "../../model-text/commands/bookmarks-command";
import {
  type BookmarkChange,
  BookmarkChangeSchema,
  type BookmarkSide,
} from "../../schemas/bookmark-change";
import {
  type WindowTabAction,
  ListedBookmarkSchema,
} from "../../schemas/window-tab";
import {
  bookmarkChangesAreShown,
  recordBookmarkChanges,
} from "../bookmark-changes";
import { askWindow, WINDOW_TAB_TIMEOUT_MS } from "../chat/window-tab";
import { agentPathOfFileUrl, fileUrlOfHostPath } from "../local-page-address";
import { hostPathOf } from "../workspace-fs-layout";
import { bookmarkChangeLines } from "../bookmark-change-lines";
import {
  type CapabilityContext,
  CapabilityFailure,
  defineCapability,
} from "./define";

const NAME = BOOKMARKS_COMMAND.name;

/** What each root is called, as the app names it. */
const ROOT_TITLES = { all: "All Bookmarks", bar: "Bookmarks bar" };

/** A bookmark or folder as the agent reads it: a file's address as its own path. */
const Listed = ListedBookmarkSchema.omit({ url: true }).extend({
  /** A bookmark's address: a page's URL, an `instrument://` address, or a file's or folder's path. */
  address: z.string().optional(),
});
type Listed = z.output<typeof Listed>;

/**
 * Asks the window, which answers once the app has read the bookmarks or
 * `BOOKMARKS_READ_WAIT_MS` has passed, so the wait for its answer covers
 * that.
 */
function ask(action: WindowTabAction, ctx: CapabilityContext) {
  return askWindow({
    action,
    askedBy: ctx.chatId,
    group: ctx.chatId,
    timeoutMs: BOOKMARKS_READ_WAIT_MS + WINDOW_TAB_TIMEOUT_MS,
  });
}

/**
 * A bookmark's address as the agent names it: a file's or folder's by the
 * path its own tools read it at, or as one outside its folders.
 */
function addressFor(url: string, ctx: CapabilityContext): string {
  if (!url.startsWith("file:") || ctx.layout === undefined) {
    return url;
  }
  return agentPathOfFileUrl(ctx.layout, url) ?? "a file outside your folders";
}

/** How much of an id a list shows, enough to tell bookmarks apart. */
const SHOWN_ID_LENGTH = 8;

/** Every bookmark and folder, as the window lists them. */
async function bookmarksNow(ctx: CapabilityContext) {
  const answer = await ask({ kind: "bookmarks" }, ctx);
  if (!answer) {
    throw new Error("the window did not answer, so no bookmark was read.");
  }
  if (answer.error !== undefined) {
    throw new Error(answer.error);
  }
  return answer.bookmarks ?? [];
}

type FromWindow = Awaited<ReturnType<typeof bookmarksNow>>[number];

/** The bookmark or folder an id names, whole or as the list shows it. */
function withId(listed: readonly FromWindow[], id: string): FromWindow {
  const exact = listed.find((each) => each.id === id);
  if (exact) {
    return exact;
  }
  const found =
    id.length < SHOWN_ID_LENGTH
      ? []
      : listed.filter((each) => each.id.startsWith(id));
  if (found.length > 1) {
    throw new Error(
      `"${id}" begins several ids: ${found.map((each) => each.id).join(", ")}.`,
    );
  }
  const [only] = found;
  if (!only) {
    throw new Error(
      `no bookmark or folder has the id "${id}". See ${NAME} list.`,
    );
  }
  return only;
}

/** The place an argument names: the bar, All Bookmarks, or a folder by its id or name, as the window is asked for it. */
function placeNamed(listed: readonly FromWindow[], named: string): string {
  const words = named.toLowerCase();
  if (words === "bar" || words === "all") {
    return words;
  }
  const folders = listed.filter(
    (each) => each.kind === "folder" && each.title.toLowerCase() === words,
  );
  const [only] = folders;
  if (only && folders.length === 1) {
    return only.id;
  }
  if (folders.length > 1) {
    throw new Error(
      `several folders are called "${named}": ${folders.map((each) => `${each.id} in ${placeWords(each)}`).join(", ")}. Name one by its id.`,
    );
  }
  const found = withId(listed, named);
  if (found.kind !== "folder") {
    throw new Error(`"${named}" is a bookmark, which nothing is filed in.`);
  }
  return found.id;
}

/**
 * Makes a change through the window's own store and records it for the card
 * under the reply, which has Undo. Refused where no reply is being written,
 * so no bookmark changes without a card.
 */
async function change(
  action: Extract<WindowTabAction, { kind: "changeBookmarks" }>["change"],
  ctx: CapabilityContext,
): Promise<BookmarkChange[]> {
  if (!bookmarkChangesAreShown()) {
    throw new CapabilityFailure(BOOKMARKS_NEED_A_TURN, "refused");
  }
  const answer = await ask({ change: action, kind: "changeBookmarks" }, ctx);
  if (!answer) {
    throw new Error(
      `the window did not answer, so check ${NAME} list for what changed.`,
    );
  }
  if (answer.error !== undefined) {
    throw new Error(answer.error);
  }
  const changes = answer.bookmarkChanges ?? [];
  recordBookmarkChanges(changes);
  return changes.map((each) => ({
    ...each,
    after: each.after && sideFor(each.after, ctx),
    before: each.before && sideFor(each.before, ctx),
  }));
}

/** A side of a change as the agent reads it: a file's address as its own path. */
function sideFor(side: BookmarkSide, ctx: CapabilityContext): BookmarkSide {
  return side.url === undefined
    ? side
    : { ...side, url: addressFor(side.url, ctx) };
}

const Changed = z.array(BookmarkChangeSchema);

/** What a change did, a line each. */
function changeLines(changes: readonly BookmarkChange[]): string {
  if (changes.length === 0) {
    return "Nothing changed: it was so already.";
  }
  return changes.flatMap((each) => bookmarkChangeLines(each, "id")).join("\n");
}

const IDS = z
  .array(z.string(), {
    error: `needs the ids ${NAME} list shows.`,
  })
  .min(1, `needs the ids ${NAME} list shows.`);

/** A folder's own path, the folders it is in first: `Work/Clients`. */
function pathOf({ folder, title }: Pick<Listed, "folder" | "title">) {
  return folder === undefined ? title : `${folder}/${title}`;
}

/** Where a bookmark or folder is, as a list or a line names it: `All Bookmarks`, `Bookmarks bar/Work`. */
function placeWords({ folder, root }: Pick<Listed, "folder" | "root">) {
  return `${ROOT_TITLES[root]}${folder === undefined ? "" : `/${folder}`}`;
}

export const bookmarksList = defineCapability({
  input: z.object({
    query: z.string().optional().meta({
      description:
        "Only the bookmarks and folders with every word in their name, address or folder.",
    }),
  }),
  name: "bookmarks.list",
  output: z.array(Listed),
  async run({ query }, ctx) {
    const listed = (await bookmarksNow(ctx)).map(
      ({ url, ...each }): Listed => ({
        ...each,
        ...(url === undefined ? {} : { address: addressFor(url, ctx) }),
      }),
    );
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return listed;
    }
    const matches = (each: Listed) => {
      const text = [each.title, each.address ?? "", each.folder ?? ""]
        .join("\n")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    };
    const found = listed.filter(matches);
    // A folder stays where it matches or has something in it, at any depth,
    // that does.
    return listed.filter((each) => {
      if (found.includes(each)) {
        return true;
      }
      if (each.kind !== "folder") {
        return false;
      }
      const path = pathOf(each);
      return found.some(
        (one) =>
          one.root === each.root &&
          one.folder !== undefined &&
          (one.folder === path || one.folder.startsWith(`${path}/`)),
      );
    });
  },
  summary:
    "The user's bookmarks, as the Bookmarks page lists them: the bookmarks bar, then All Bookmarks, each folder with what is filed in it.",
  surfaces: {
    cli: {
      help: "",
      positional: ["query"],
      rest: true,
      words: ["bookmarks", "list"],
    },
  },
  text: (rows) => {
    if (rows.length === 0) {
      return "No bookmarks match.";
    }
    const lines: string[] = [];
    let root: Listed["root"] | undefined;
    // How far in each folder listed so far is, by its path.
    const depths = new Map<string, number>();
    for (const row of rows) {
      if (row.root !== root) {
        root = row.root;
        depths.clear();
        lines.push(`${ROOT_TITLES[root]}:`);
      }
      const id = row.id.slice(0, SHOWN_ID_LENGTH);
      const depth =
        row.folder === undefined ? 1 : (depths.get(row.folder) ?? 1) + 1;
      if (row.kind === "folder") {
        depths.set(pathOf(row), depth);
      }
      const indent = "  ".repeat(depth);
      lines.push(
        row.kind === "folder"
          ? `${indent}${id}  ${row.title}/`
          : `${indent}${id}  ${row.title === "" ? "" : `${row.title}  `}${row.address ?? ""}`,
      );
    }
    return lines.join("\n");
  },
});

/** What an argument keeps: a page's or the app's own address, or a file or folder by its path, with the name it gets by default. */
async function keptAddressOf(
  arg: string,
  ctx: CapabilityContext,
): Promise<{ error: string } | { title: string; url: string }> {
  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    return { title: "", url: arg };
  }
  if (isInstrumentAddress(arg)) {
    const path = filePathOfInstrumentLink(arg);
    if (path !== undefined) {
      return keptAddressOf(path, ctx);
    }
    const link = instrumentLinkOf(arg);
    return link === undefined || link.kind === "tab" || link.kind === "group"
      ? { error: `"${arg}" names nothing a bookmark opens.` }
      : { title: "", url: arg };
  }
  if (ctx.shellPath === undefined) {
    return { error: `"${arg}" is a path, which only the shell resolves.` };
  }
  const found = await ctx.shellPath(arg);
  if (found.kind === "none") {
    return { error: `"${arg}" does not exist.` };
  }
  if (found.kind === "other") {
    return { error: `"${arg}" is not a file or a folder.` };
  }
  const url = fileUrlOfHostPath(hostPathOf(found.path));
  return {
    title: nodePath.posix.basename(found.path),
    url: found.kind === "folder" && !url.endsWith("/") ? `${url}/` : url,
  };
}

export const bookmarksAdd = defineCapability({
  input: z.object({
    url: z.string({
      error: `add takes a URL, an instrument:// address or a path: ${NAME} add <url or path> [title].`,
    }),
    title: z.string().optional().meta({
      description:
        "Its name; by default a file's or folder's own, and a page's address.",
    }),
  }),
  name: "bookmarks.add",
  output: Listed.extend({ isNew: z.boolean() }),
  async run({ title, url }, ctx) {
    const kept = await keptAddressOf(url, ctx);
    if ("error" in kept) {
      throw new Error(kept.error);
    }
    const answer = await ask(
      {
        kind: "addBookmark",
        title: title?.trim() || kept.title,
        url: kept.url,
      },
      ctx,
    );
    if (!answer) {
      throw new Error("the window did not answer, so nothing was bookmarked.");
    }
    if (answer.error !== undefined || answer.bookmark === undefined) {
      throw new Error(answer.error ?? "the window bookmarked nothing.");
    }
    recordBookmarkChanges(answer.bookmarkChanges ?? []);
    const { url: address, ...bookmark } = answer.bookmark;
    return {
      ...bookmark,
      ...(address === undefined ? {} : { address: addressFor(address, ctx) }),
    };
  },
  summary:
    "Keep a page, a file or a folder as the user's bookmark, as the app's Add to Bookmarks does: last in All Bookmarks.",
  surfaces: {
    cli: {
      help: "",
      positional: ["url", "title"],
      rest: true,
      words: ["bookmarks", "add"],
    },
  },
  text: (bookmark) => {
    const name = bookmark.title || bookmark.address || "";
    return bookmark.isNew
      ? `Bookmarked "${name}" in ${placeWords(bookmark)}.`
      : `Already bookmarked as "${name}" in ${placeWords(bookmark)}.`;
  },
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});

export const bookmarksMove = defineCapability({
  input: z.object({
    ids: IDS,
    to: z.string().optional().meta({
      description: "`bar`, `all` (All Bookmarks), or a folder's id or name.",
    }),
    before: z.string().optional().meta({
      description: "The id of the one they go just before, in order.",
    }),
    after: z.string().optional().meta({
      description: "The id of the one they go just after, in order.",
    }),
  }),
  name: "bookmarks.move",
  output: Changed,
  async run({ after, before, ids, to }, ctx) {
    if (before !== undefined && after !== undefined) {
      throw new Error("move takes one of --before and --after.");
    }
    if (to === undefined && before === undefined && after === undefined) {
      throw new Error(
        `move needs where they go: --to <bar|all|folder>, --before <id> or --after <id>.`,
      );
    }
    const listed = await bookmarksNow(ctx);
    return change(
      {
        ids: ids.map((id) => withId(listed, id).id),
        type: "move",
        ...(to === undefined ? {} : { to: placeNamed(listed, to) }),
        ...(before === undefined ? {} : { before: withId(listed, before).id }),
        ...(after === undefined ? {} : { after: withId(listed, after).id }),
      },
      ctx,
    );
  },
  summary:
    "Move bookmarks to the bookmarks bar, All Bookmarks or a folder, last there or beside another. A folder stays on the bar or in All Bookmarks and only changes its order there.",
  surfaces: {
    cli: { help: "", positional: ["ids"], words: ["bookmarks", "move"] },
  },
  text: changeLines,
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});

export const bookmarksRename = defineCapability({
  input: z.object({
    id: z.string({ error: `rename takes an id: ${NAME} rename <id> <name>.` }),
    title: z.string({
      error: `rename takes a name: ${NAME} rename <id> <name>.`,
    }),
  }),
  name: "bookmarks.rename",
  output: Changed,
  async run({ id, title }, ctx) {
    const listed = await bookmarksNow(ctx);
    return change(
      { id: withId(listed, id).id, title: title.trim(), type: "rename" },
      ctx,
    );
  },
  summary: "Rename a bookmark or a folder.",
  surfaces: {
    cli: {
      help: "",
      positional: ["id", "title"],
      rest: true,
      words: ["bookmarks", "rename"],
    },
  },
  text: changeLines,
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});

export const bookmarksAddress = defineCapability({
  input: z.object({
    id: z.string({
      error: `address takes an id: ${NAME} address <id> <url or path>.`,
    }),
    url: z.string({
      error: `address takes a URL, an instrument:// address or a path: ${NAME} address <id> <url or path>.`,
    }),
  }),
  name: "bookmarks.address",
  output: Changed,
  async run({ id, url }, ctx) {
    const kept = await keptAddressOf(url, ctx);
    if ("error" in kept) {
      throw new Error(kept.error);
    }
    const listed = await bookmarksNow(ctx);
    return change(
      { id: withId(listed, id).id, type: "setUrl", url: kept.url },
      ctx,
    );
  },
  summary: "Change the page, file or folder a bookmark opens.",
  surfaces: {
    cli: {
      help: "",
      positional: ["id", "url"],
      words: ["bookmarks", "address"],
    },
  },
  text: changeLines,
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});

export const bookmarksNewFolder = defineCapability({
  input: z.object({
    title: z.string({
      error: `new-folder takes a name: ${NAME} new-folder <name>.`,
    }),
    in: z.string().default("all").meta({
      description:
        "`bar` puts it on the bookmarks bar, `all` in All Bookmarks, and a folder's id or name in that folder.",
    }),
  }),
  name: "bookmarks.newFolder",
  output: Changed,
  async run({ in: named, title }, ctx) {
    const place = placeNamed(await bookmarksNow(ctx), named);
    return change(
      place === "bar" || place === "all"
        ? { root: place, title: title.trim(), type: "newFolder" }
        : {
            folder: place,
            root: "all",
            title: title.trim(),
            type: "newFolder",
          },
      ctx,
    );
  },
  summary:
    "Make a bookmark folder, last in All Bookmarks, on the bookmarks bar, or in a folder.",
  surfaces: {
    cli: {
      help: "",
      positional: ["title"],
      rest: true,
      words: ["bookmarks", "new-folder"],
    },
  },
  text: changeLines,
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});

export const bookmarksRemove = defineCapability({
  input: z.object({ ids: IDS }),
  name: "bookmarks.remove",
  output: Changed,
  async run({ ids }, ctx) {
    const listed = await bookmarksNow(ctx);
    return change(
      { ids: ids.map((id) => withId(listed, id).id), type: "remove" },
      ctx,
    );
  },
  summary:
    "Remove bookmarks, or a folder with every bookmark in it. The card under the reply has Undo.",
  surfaces: {
    cli: { help: "", positional: ["ids"], words: ["bookmarks", "remove"] },
  },
  text: changeLines,
  where: { roleRefusal: BOOKMARKS_ARE_THE_CHATS, roles: ["chat"] },
});
