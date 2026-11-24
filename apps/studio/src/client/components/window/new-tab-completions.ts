import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import { type OfferedPage, matchKnownPages } from "./known-pages";
import { addressCompletion, bareAddress } from "./omnibar-match";
import { isKnownSite } from "./typed-address-row";

/** How many pages from history and the bookmarks the list offers under what was typed. */
const PAGES_SHOWN = 4;

/** A row under a new tab's box: what the words open. */
export type BoxCompletion =
  /** The words themselves, when they are an address, and whether the window has been to its site. */
  | { address: TypedAddress; id: string; isKnown: boolean; kind: "address" }
  /** The words themselves, when they are a place on the computer. */
  | { id: string; kind: "path"; path: TypedPath }
  /** A page or a site from history, or a bookmark, the words find. */
  | { id: string; kind: "page"; page: OfferedPage; ranges: null | number[] };

/**
 * Whether a new tab's box is offering to open what is in it: while its words
 * are one line with no space in them, and are not a slash command. A slash
 * and one name is a command unless it is a folder at the computer's root
 * that no search starts with (`/tmp`, `/Users`), which is a path. A path
 * may have spaces only where they are quoted or escaped, as a pasted one
 * has them; a space at the end always ends the offer, so a domain followed
 * by a space is sent as a message.
 */
export function offersToOpen(words: string, path: TypedPath | undefined) {
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
export function boxAddress(words: string): TypedAddress | undefined {
  const address = typedAddress(words);
  return address?.kind === "page" && address.doubt ? undefined : address;
}

/**
 * The rows under a new tab's box for what was typed, and the one Return
 * opens before an arrow picks another: the words themselves, as a place on
 * the computer or an address, first and picked; then the site history
 * completes them to; then the bookmarks and the pages visited they find, as
 * the command menu finds them. With no row for the words themselves, none
 * is picked, so Return sends the words as a message.
 */
export function boxCompletions({
  address,
  bookmarkPages,
  path,
  recentPages,
  words,
}: {
  address: TypedAddress | undefined;
  bookmarkPages: OfferedPage[];
  path: TypedPath | undefined;
  recentPages: OfferedPage[];
  words: string;
}): { picked: number; rows: BoxCompletion[] } {
  const head: BoxCompletion[] = path
    ? [{ id: `path:${path.typed}`, kind: "path", path }]
    : address
      ? [
          {
            address,
            id: "address",
            isKnown:
              address.kind === "page" &&
              isKnownSite(address.url, [...bookmarkPages, ...recentPages]),
            kind: "address",
          },
        ]
      : [];
  const taken = new Set(
    address?.kind === "page" ? [bareAddress(address.url)] : [],
  );
  const site = path ? undefined : siteCompletion(words, recentPages);
  const sites: BoxCompletion[] =
    site && !taken.has(bareAddress(site.url))
      ? [{ id: `site:${site.url}`, kind: "page", page: site, ranges: null }]
      : [];
  if (site) {
    taken.add(bareAddress(site.url));
  }
  const pages: BoxCompletion[] = path
    ? []
    : [
        ...matchKnownPages(bookmarkPages, words),
        ...matchKnownPages(recentPages, words),
      ]
        .filter(({ item }) => !taken.has(bareAddress(item.url)))
        .slice(0, PAGES_SHOWN)
        .map(({ item, ranges }) => ({
          id: `page:${item.url}`,
          kind: "page",
          page: item,
          ranges,
        }));
  return {
    picked: head.length > 0 ? 0 : -1,
    rows: [...head, ...sites, ...pages],
  };
}

/**
 * The site history completes the words to, as the address field completes
 * them (`addressCompletion`): "git" to github.com. Only a site, never a page
 * on it, and at the address the person visited it by.
 */
function siteCompletion(
  words: string,
  pages: OfferedPage[],
): OfferedPage | undefined {
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
  return {
    favicon: visited.favicon,
    title: "",
    url: `${new URL(visited.url).origin}/`,
  };
}
