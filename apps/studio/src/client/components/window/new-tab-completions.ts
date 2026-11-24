import { type TypedAddress, typedAddress } from "@/client/lib/typed-address";
import { type TypedPath } from "@/client/lib/typed-path";

import { foldWords } from "@/shared/name-match";

import { type OfferedPage } from "./known-pages";
import { findNamed, flatSearch, type Named, rangesOf } from "./name-search";
import { addressCompletion, bareAddress, siteOf } from "./omnibar-match";
import { type SearchThing } from "./search-sources";
import { isKnownSite } from "./typed-address-row";

/** How many things found by name the list offers under what was typed. */
const FOUND_SHOWN = 6;
/** How many visits make a site one the box completes the words to. */
const VISITS_TO_COMPLETE = 2;

/** A page as history or the bookmarks list it. */
type VisitedPage = { favicon?: string | undefined; title: string; url: string };

/** A row under a new tab's box: what the words open. */
export type BoxCompletion =
  /** The words themselves, when they are an address, and whether the window has been to its site. */
  | { address: TypedAddress; id: string; isKnown: boolean; kind: "address" }
  /** The words themselves, when they are a place on the computer. */
  | { id: string; kind: "path"; path: TypedPath }
  /** The site history completes the words to. */
  | { id: string; kind: "site"; page: OfferedPage }
  /** Something the words find by name, as the command menu finds it. */
  | {
      id: string;
      kind: "thing";
      /** The name its row shows, and what to draw as matched in it. */
      name: string;
      ranges: null | number[];
      thing: SearchThing;
    };

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
 * opens before an arrow picks another. First the words themselves, as a
 * place on the computer or an address, picked. Then the site history
 * completes them to, which is first and picked instead while the box has
 * written the rest of its address in (`isCompleted`). Then what the words
 * find by name among open tabs, chats, folders, files, projects and pages,
 * all in one list, best first (`flatSearch`), with the remembered pick
 * moved to its front: six at most, never picked on their own. With no row
 * picked, Return sends the words as a message.
 */
export function boxCompletions({
  address,
  bookmarkPages,
  isCompleted = false,
  named = [],
  path,
  recentPages,
  remembered,
  words,
}: {
  address: TypedAddress | undefined;
  bookmarkPages: OfferedPage[];
  /** Whether the box shows the rest of the site's address after the caret. */
  isCompleted?: boolean;
  /** Everything the box finds by name (`useSearchSources`). */
  named?: readonly Named<SearchThing>[];
  path: TypedPath | undefined;
  recentPages: OfferedPage[];
  /** What was picked the last time these words were typed (`rememberedPick`). */
  remembered?: string | undefined;
  words: string;
}): { picked: number; rows: BoxCompletion[] } {
  const typed: BoxCompletion[] = path
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
  const site = path ? undefined : siteCompletion(words, recentPages)?.site;
  const sites: BoxCompletion[] =
    site && !taken.has(bareAddress(site.url))
      ? [{ id: `site:${site.url}`, kind: "site", page: site }]
      : [];
  if (site) {
    taken.add(bareAddress(site.url));
  }
  const completes = isCompleted && sites.length > 0;
  const head = completes ? [...sites, ...typed] : [...typed, ...sites];
  const folded = foldWords(words);
  const found: BoxCompletion[] = path
    ? []
    : flatSearch({
        found: findNamed(
          named.filter(
            ({ value }) =>
              value.kind !== "page" || !taken.has(bareAddress(value.page.url)),
          ),
          folded,
        ),
        limit: FOUND_SHOWN,
        remembered,
      }).map((each) => ({
        id: each.entry.id,
        kind: "thing",
        name: each.entry.name,
        ranges: rangesOf(each, folded),
        thing: each.entry.value,
      }));
  return {
    picked: completes || typed.length > 0 ? 0 : -1,
    rows: [...head, ...found],
  };
}

/**
 * The rest of a site's address for a new tab's box to write in after the
 * caret: the site history completes the words to (`siteCompletion`), when
 * the person has been to it more than once. `visited` is history as it came,
 * each page with how often it was visited.
 */
export function siteToComplete(
  words: string,
  visited: (VisitedPage & { visitCount: number })[],
): string | undefined {
  const completion = siteCompletion(words, visited);
  if (!completion) {
    return undefined;
  }
  const site = siteOf(completion.site.url).toLowerCase();
  const visits = visited
    .filter((page) => siteOf(page.url).toLowerCase() === site)
    .reduce((count, page) => count + page.visitCount, 0);
  return visits >= VISITS_TO_COMPLETE ? completion.rest : undefined;
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
): undefined | { rest: string; site: OfferedPage } {
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
    rest,
    site: {
      favicon: visited.favicon,
      title: "",
      url: `${new URL(visited.url).origin}/`,
    },
  };
}
