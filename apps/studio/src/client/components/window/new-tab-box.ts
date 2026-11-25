import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import { foldName, foldText } from "@/shared/name-match";
import { stripDictatedMarks } from "@instrument-org/shared/dictated-text";

import {
  addressCompletion,
  bareAddress,
  type KnownPage,
  siteOf,
} from "./omnibar-match";

/** How many pages the list under a new tab's box shows. */
const MOST_PAGES_LISTED = 4;

/** A page the box may offer, with the icon it last announced. */
type OfferedPage = KnownPage & { favicon: string | undefined };

/** A page the words find, as a row of the list under a new tab's box. */
export type BoxPageRow = {
  /** The page's address as the row shows it: no scheme, no `www.`, no query. */
  address: string;
  /** What to draw bold in `address`, as pairs of offsets, or null. */
  addressRanges: null | number[];
  page: OfferedPage;
  /** The page's title, or empty when it has none worth showing. */
  title: string;
  /** What to draw bold in `title`, as pairs of offsets, or null. */
  titleRanges: null | number[];
};

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
 * What a typed word means once the parts of an address that say nothing
 * about the page are taken off: a scheme (`https://`) and `www.`. A word
 * that is only one of those, or a scheme's name alone (`http`), finds no
 * page, since nearly every address has one.
 */
function meaningfulWord(words: string): string | undefined {
  const word = words
    .toLowerCase()
    .replace(/^(?:https?|ftp|file):(?:\/\/)?/, "")
    .replace(/^www\./, "");
  return word === "" || TRIVIAL_WORDS.has(word) ? undefined : word;
}

/** Words every address starts with, which a page is never found by alone. */
const TRIVIAL_WORDS: ReadonlySet<string> = new Set([
  "file",
  "ftp",
  "http",
  "https",
  "www",
]);

/** Where in a page the word was found, best first: how the rows are ordered. */
const MATCH_PLACES = ["address", "site", "title", "path"] as const;

/** A page's address as a row shows it: no scheme, no `www.`, no query or fragment. */
function shownAddress(url: string): { address: string; siteLength: number } {
  const bare = bareAddress(url).split(/[?#]/)[0] ?? "";
  const address = bare.replace(/\/$/, "");
  return { address, siteLength: siteOf(url).length };
}

/** A title that is the page's own address says nothing more than the address does. */
function titleOf(page: KnownPage): string {
  const title = page.title.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(title) ||
    bareAddress(title) === bareAddress(page.url)
    ? ""
    : title;
}

/** `ranges`, pairs of offsets into a part of the address, moved to where that part starts. */
function shifted(ranges: number[], by: number): number[] {
  return ranges.map((offset) => offset + by);
}

/** A letter or digit, which continues a word rather than starting one. */
const IN_WORD = /[\p{L}\p{N}]/u;

/**
 * Where the word starts a word of `text`, as highlight ranges, or undefined
 * when it starts none. A word starts at the beginning or after a character
 * that is neither a letter nor a digit, so "hub" never finds "GitHub" and "3"
 * never finds "v13". `before` limits where the match may start, as a site's
 * last part (`com`) finds nothing.
 */
function wordStartRanges(
  text: string,
  word: string,
  before = Number.POSITIVE_INFINITY,
): number[] | undefined {
  const name = foldName(text);
  const folded = foldText(word);
  let at = name.text.indexOf(folded);
  while (at !== -1 && at < before) {
    if (at === 0 || !IN_WORD.test(name.text.charAt(at - 1))) {
      const end = at + folded.length;
      return name.offsets
        ? [name.offsets[at] ?? 0, name.offsets[end] ?? text.length]
        : [at, end];
    }
    at = name.text.indexOf(folded, at + 1);
  }
  return undefined;
}

/**
 * How the word finds a page, or undefined: `place` is the best of
 * `MATCH_PLACES` that holds, and the ranges mark every place it holds, so a
 * word in both a title and a path is bold in both.
 *
 * - `address`: the word starts the address as a person types it (`github.com/ac`)
 * - `site`: it starts a part of the site's name (`news` in news.ycombinator.com),
 *   never its last part (`com`)
 * - `title`: it starts a word of the page's title
 * - `path`: it starts a word of the address after the site; the query and
 *   fragment are never read
 */
function pageMatch(
  page: OfferedPage,
  word: string,
):
  | undefined
  | (Omit<BoxPageRow, "page"> & {
      place: (typeof MATCH_PLACES)[number];
    }) {
  const { address, siteLength } = shownAddress(page.url);
  const title = titleOf(page);
  const site = address.slice(0, siteLength);
  const path = address.slice(siteLength + 1);
  const lastPart = site.lastIndexOf(".");
  const inAddress = address.toLowerCase().startsWith(word)
    ? [0, Math.min(word.length, address.length)]
    : undefined;
  const inSite = inAddress
    ? undefined
    : wordStartRanges(
        site,
        word,
        lastPart === -1 ? Number.POSITIVE_INFINITY : lastPart + 1,
      );
  const inTitle = title === "" ? undefined : wordStartRanges(title, word);
  const inPath =
    inAddress || inSite || path === ""
      ? undefined
      : wordStartRanges(path, word);
  const place = inAddress
    ? "address"
    : inSite
      ? "site"
      : inTitle
        ? "title"
        : inPath
          ? "path"
          : undefined;
  if (place === undefined) {
    return undefined;
  }
  return {
    address,
    addressRanges:
      inAddress ?? inSite ?? (inPath ? shifted(inPath, siteLength + 1) : null),
    place,
    title,
    titleRanges: inTitle ?? null,
  };
}

/**
 * The pages under a new tab's box while it holds one word with no space:
 * each page whose address the word starts, whose site has a part it starts,
 * whose title has a word it starts, then whose path has one, each in
 * `pages`' order (bookmarks, then the pages visited, newest first), each
 * address once, at most four. The site the box finished the word to is left
 * out, since the box itself opens it. Each row says what to draw bold, so the
 * reason it is there shows. Nothing for a scheme or `www` alone, a place on
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
  const word = meaningfulWord(words);
  if (word === undefined) {
    return [];
  }
  const shown = new Set(
    completedSite === undefined ? [] : [shownAddress(completedSite).address],
  );
  const found = pages.flatMap((page) => {
    const match = pageMatch(page, word);
    return match ? [{ ...match, page }] : [];
  });
  const rows: BoxPageRow[] = [];
  for (const place of MATCH_PLACES) {
    for (const match of found) {
      if (match.place !== place || shown.has(match.address)) {
        continue;
      }
      shown.add(match.address);
      rows.push({
        address: match.address,
        addressRanges: match.addressRanges,
        page: match.page,
        title: match.title,
        titleRanges: match.titleRanges,
      });
    }
  }
  return rows.slice(0, MOST_PAGES_LISTED);
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
