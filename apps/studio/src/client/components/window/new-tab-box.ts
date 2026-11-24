import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import { addressCompletion, bareAddress, siteOf } from "./omnibar-match";

/** How many visits make a site one the box completes the words to. */
const VISITS_TO_COMPLETE = 2;

/** A page as history or the bookmarks list it. */
type VisitedPage = { title: string; url: string };

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
 * caret, and the address it then opens: the site history completes the
 * words to (`siteCompletion`), when the person has been to it more than
 * once, and only while the words could be an address at all. `visited` is history as it came,
 * each page with how often it was visited.
 */
export function siteToComplete(
  words: string,
  visited: (VisitedPage & { visitCount: number })[],
): undefined | { rest: string; url: string } {
  const completion = offersToOpen(words, undefined)
    ? siteCompletion(words, visited)
    : undefined;
  if (!completion) {
    return undefined;
  }
  const site = siteOf(completion.url).toLowerCase();
  const visits = visited
    .filter((page) => siteOf(page.url).toLowerCase() === site)
    .reduce((count, page) => count + page.visitCount, 0);
  return visits >= VISITS_TO_COMPLETE
    ? { rest: completion.rest, url: completion.url }
    : undefined;
}

/**
 * The site history completes the words to, as the address field completes
 * them (`addressCompletion`): "git" to github.com, with the rest of its
 * address after the words. Only a site, never a page on it, and at the
 * address the person visited it by.
 */
function siteCompletion(
  words: string,
  pages: VisitedPage[],
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
