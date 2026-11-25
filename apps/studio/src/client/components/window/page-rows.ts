import { foldName, foldText } from "@/shared/name-match";

import {
  bareAddress,
  type KnownPage,
  type OfferedPage,
  siteOf,
} from "./omnibar-match";

/** How many pages a list shows. */
const MOST_PAGES_LISTED = 4;

/** A page typed words find, as the address field and a new tab's box list it. */
export type PageRow = {
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

/**
 * The pages typed words find: every word finds it somewhere (`pageMatch`),
 * and a page is placed by the weakest place a word of them was found, so one
 * whose address they start comes first, then its site, its title and its
 * path, each in `pages`' order, each address once, at most four. Each row
 * says what to draw bold, so the reason it is there shows. Nothing for a
 * scheme or `www` alone.
 */
export function pageRows({
  leaveOut,
  pages,
  words,
}: {
  /** The address of a page something else already offers. */
  leaveOut?: string | undefined;
  pages: OfferedPage[];
  words: string;
}): PageRow[] {
  const terms = words
    .trim()
    .split(/\s+/)
    .flatMap((term) => meaningfulWord(term) ?? []);
  if (terms.length === 0) {
    return [];
  }
  const shown = new Set(
    leaveOut === undefined ? [] : [shownAddress(leaveOut).address],
  );
  const found = pages.flatMap((page) => {
    const matches = terms.flatMap((term) => pageMatch(page, term) ?? []);
    const [first] = matches;
    return first === undefined || matches.length < terms.length
      ? []
      : [
          {
            place: Math.max(
              ...matches.map((match) => MATCH_PLACES.indexOf(match.place)),
            ),
            row: {
              address: first.address,
              addressRanges: merged(matches.map((each) => each.addressRanges)),
              page,
              title: first.title,
              titleRanges: merged(matches.map((each) => each.titleRanges)),
            } satisfies PageRow,
          },
        ];
  });
  const rows: PageRow[] = [];
  for (const { row } of found.toSorted((a, b) => a.place - b.place)) {
    if (!shown.has(row.address)) {
      shown.add(row.address);
      rows.push(row);
    }
  }
  return rows.slice(0, MOST_PAGES_LISTED);
}

/** Several words' highlight ranges as one, in order, with those that overlap joined. */
function merged(all: (null | number[])[]): null | number[] {
  const pairs = all
    .flatMap((ranges) =>
      ranges && ranges[0] !== undefined && ranges[1] !== undefined
        ? [{ end: ranges[1], start: ranges[0] }]
        : [],
    )
    .sort((a, b) => a.start - b.start);
  const out: { end: number; start: number }[] = [];
  for (const pair of pairs) {
    const last = out.at(-1);
    if (last && pair.start <= last.end) {
      last.end = Math.max(last.end, pair.end);
    } else {
      out.push(pair);
    }
  }
  return out.length === 0
    ? null
    : out.flatMap(({ end, start }) => [start, end]);
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
  | (Omit<PageRow, "page"> & {
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
