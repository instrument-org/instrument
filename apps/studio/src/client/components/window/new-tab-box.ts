import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import {
  addressCompletion,
  bareAddress,
  type KnownPage,
} from "./omnibar-match";

/** How many pages the list under a new tab's box shows. */
const MOST_PAGES_LISTED = 4;

/** A page the box may offer, with the icon it last announced. */
type OfferedPage = KnownPage & { favicon: string | undefined };

/**
 * A row of the list under a new tab's box: the site the box finished the
 * words to, or a page the words find.
 */
export type BoxPageRow = { kind: "page" | "site"; page: OfferedPage };

/** What Return opens from a new tab's box, in place of sending its words. */
export type BoxOpens =
  /** The words themselves, when they are an address. */
  | { address: TypedAddress; kind: "address" }
  /** The words themselves, when they are a place on the computer. */
  | { kind: "path"; path: TypedPath }
  /** The site the box finished the words to, at its address. */
  | { kind: "site"; url: string };

/**
 * Whether a new tab's box may open what is in it: while its words are one
 * line with no space in them, and are not a slash command. A slash
 * and one name is a command unless it is a folder at the computer's root
 * that no search starts with (`/tmp`, `/Users`), which is a path. A path
 * may have spaces only where they are quoted or escaped, as a pasted one
 * has them; and a space at the end makes anything a message, so a domain
 * followed by a space is sent.
 */
function offersToOpen(words: string, path: TypedPath | undefined) {
  if (words === "" || words.includes("\n") || /\s$/.test(words)) {
    return false;
  }
  if (
    /^\/[\w:-]*$/.test(words) &&
    (words === "/" || path === undefined || path.alsoSearch)
  ) {
    return false;
  }
  if (!/\s/.test(words)) {
    return true;
  }
  return (
    path !== undefined &&
    (/^(["']).*\1$/.test(words) || !/(?<!\\)\s/.test(words))
  );
}

/**
 * The address a new tab's box takes typed words for (`typedAddress`): one a
 * browser would go to without asking, or one of the app's own. Words whose
 * address is in doubt (`node.js`, `ftp://`) are a message here.
 */
function boxAddress(words: string): TypedAddress | undefined {
  const address = typedAddress(words);
  return address?.kind === "page" && address.doubt ? undefined : address;
}

/**
 * What Return opens from a new tab's box, or nothing when it sends the
 * words: a place on the computer or an address, when that is all the box
 * holds, and the site the box wrote the rest of after the caret
 * (`completedSite`). Words with a space, a link among them, one word that
 * is no address and an address in doubt are all a message.
 */
export function boxOpens({
  completedSite,
  path,
  words,
}: {
  /** The address of the site the box finished the words to, while its rest is in the box. */
  completedSite?: string | undefined;
  path: TypedPath | undefined;
  words: string;
}): BoxOpens | undefined {
  if (!offersToOpen(words, path)) {
    return undefined;
  }
  if (path) {
    return { kind: "path", path };
  }
  if (completedSite !== undefined) {
    return { kind: "site", url: completedSite };
  }
  const address = boxAddress(words);
  return address ? { address, kind: "address" } : undefined;
}

/**
 * The rest of a site's address for a new tab's box to write in after the
 * caret, and the address it then opens: the site the words start, among
 * `pages`, while the words could be an address at all. `pages` are what the
 * address field completes to, the bookmarks and then the pages history
 * counts as significant (typed once, visited often or lately), newest
 * first, so the box and the address field finish the same words the same
 * way.
 */
export function siteToComplete(
  words: string,
  pages: KnownPage[],
): undefined | { rest: string; url: string } {
  return offersToOpen(words, undefined)
    ? siteCompletion(words, pages)
    : undefined;
}

/**
 * The rows under a new tab's box while it holds one word with no space: the
 * site the box finished the words to first, then the pages whose address
 * the words start, then those with a word in their title or address the
 * words start, each in `pages`' order, at most four. Nothing for a place on
 * the computer, words with a space, or a slash command.
 */
export function boxPageRows({
  completedSite,
  pages,
  path,
  words,
}: {
  /** The address of the site the box finished the words to, while its rest is in the box. */
  completedSite?: string | undefined;
  pages: OfferedPage[];
  path: TypedPath | undefined;
  words: string;
}): BoxPageRow[] {
  if (path !== undefined || /\s/.test(words) || !offersToOpen(words, path)) {
    return [];
  }
  const typed = words.toLowerCase().replace(/^www\./, "");
  const startsAWord = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => word !== "" && word.startsWith(typed));
  const leading = pages.filter((page) =>
    bareAddress(page.url).toLowerCase().startsWith(typed),
  );
  const wordStarts = pages.filter(
    (page) =>
      !leading.includes(page) &&
      (startsAWord(page.title) || startsAWord(bareAddress(page.url))),
  );
  const siteAddress =
    completedSite === undefined ? undefined : bareAddress(completedSite);
  const isSite = (page: OfferedPage) => bareAddress(page.url) === siteAddress;
  const site =
    completedSite === undefined
      ? undefined
      : {
          favicon: pages.find(isSite)?.favicon,
          title: "",
          url: completedSite,
        };
  const rows: BoxPageRow[] = [
    ...(site ? [{ kind: "site" as const, page: site }] : []),
    ...[...leading, ...wordStarts]
      .filter((page) => !isSite(page))
      .map((page) => ({ kind: "page" as const, page })),
  ];
  return rows.slice(0, MOST_PAGES_LISTED);
}

/**
 * The site the pages complete the words to, as the address field completes
 * them (`addressCompletion`): "git" to github.com, with the rest of its
 * address after the words. Only a site, never a page on it, and at the
 * address the person visited it by.
 */
function siteCompletion(
  words: string,
  pages: KnownPage[],
): undefined | { rest: string; url: string } {
  const rest = addressCompletion(words, pages);
  if (rest === "") {
    return undefined;
  }
  const completed = `${words.replace(/^www\./i, "")}${rest}`.toLowerCase();
  if (/[/?#]/.test(completed)) {
    return undefined;
  }
  const visited = pages.find(
    (page) =>
      bareAddress(page.url).split(/[/?#]/)[0]?.toLowerCase() === completed,
  );
  if (!visited || !URL.canParse(visited.url)) {
    return undefined;
  }
  return { rest, url: `${new URL(visited.url).origin}/` };
}
