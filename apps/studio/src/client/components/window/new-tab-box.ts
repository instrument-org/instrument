import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import { stripDictatedMarks } from "@instrument-org/shared/dictated-text";

import {
  addressCompletion,
  bareAddress,
  type KnownPage,
  type OfferedPage,
} from "./omnibar-match";
import { type PageRow, pageRows } from "./page-rows";

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
 * The pages under a new tab's box (`pageRows`), while it holds one word with
 * no space. The site the box finished the word to is left out, since the box
 * itself opens it. Nothing for a place on the computer, words with a space,
 * or a slash command.
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
}): PageRow[] {
  return path !== undefined || /\s/.test(words) || !offersToOpen(words, path)
    ? []
    : pageRows({ leaveOut: completedSite, pages, words });
}

/**
 * The words the last row under a new tab's box searches the web for, while
 * the box holds anything but an address, a place on the computer, or words
 * the box has a menu or a chip for: a slash being typed, and a link or a
 * mention, which are written as Markdown. Whether the words also fit on one
 * line is the box's to say (`PromptEditorRef.isOneLine`).
 */
export function boxSearchWords(
  words: string,
  path: TypedPath | undefined,
): string | undefined {
  const search = stripDictatedMarks(words).trim();
  if (
    search === "" ||
    search.includes("\n") ||
    path !== undefined ||
    /(?:^|\s)\/[\w:-]*$/.test(words) ||
    search.includes("](") ||
    boxAddress(search) !== undefined
  ) {
    return undefined;
  }
  return search;
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
