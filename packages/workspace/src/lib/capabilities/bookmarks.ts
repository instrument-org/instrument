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
} from "../../model-text/commands/bookmarks-command";
import {
  type WindowTabAction,
  ListedBookmarkSchema,
} from "../../schemas/window-tab";
import { askWindow, WINDOW_TAB_TIMEOUT_MS } from "../chat/window-tab";
import { agentPathOfFileUrl, fileUrlOfHostPath } from "../local-page-address";
import { hostPathOf } from "../workspace-fs-layout";
import { type CapabilityContext, defineCapability } from "./define";

const NAME = BOOKMARKS_COMMAND.name;

/** What each root is called, as the app names it. */
const ROOT_TITLES = { all: "All Bookmarks", bar: "Bookmarks bar" };

/** A bookmark or folder as the agent reads it: a file's address as its own path. */
const Listed = ListedBookmarkSchema.omit({ url: true }).extend({
  /** A bookmark's address: a page's URL, an `instrument://` address, or a file's or folder's path. */
  address: z.string().optional(),
});
type Listed = z.output<typeof Listed>;

function ask(action: WindowTabAction, ctx: CapabilityContext) {
  return askWindow({
    action,
    askedBy: ctx.chatId,
    group: ctx.chatId,
    timeoutMs: WINDOW_TAB_TIMEOUT_MS,
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
    const answer = await ask({ kind: "bookmarks" }, ctx);
    if (!answer) {
      throw new Error("the window did not answer, so no bookmark was read.");
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    const listed = (answer.bookmarks ?? []).map(
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
    const found = listed.filter(
      (each) => each.kind === "bookmark" && matches(each),
    );
    // A folder stays where it matches or holds a bookmark that does.
    return listed.filter(
      (each) =>
        found.includes(each) ||
        (each.kind === "folder" &&
          (matches(each) ||
            found.some(
              (bookmark) =>
                bookmark.root === each.root && bookmark.folder === each.title,
            ))),
    );
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
    for (const row of rows) {
      if (row.root !== root) {
        root = row.root;
        lines.push(`${ROOT_TITLES[root]}:`);
      }
      const indent = row.folder === undefined ? "  " : "    ";
      lines.push(
        row.kind === "folder"
          ? `  ${row.title}/`
          : `${indent}${row.title === "" ? "" : `${row.title}  `}${row.address ?? ""}`,
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
