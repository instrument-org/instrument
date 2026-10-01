import uFuzzy from "@leeoniya/ufuzzy";

/** A page the field can offer again: one the browser showed, or a bookmark. */
export interface KnownPage {
  title: string;
  url: string;
}

/** A folder's entry, as the folder listing gives it. */
export interface ListedEntry {
  hidden?: boolean | undefined;
  kind: "file" | "folder";
  name: string;
  path: string;
}

/** What typed words are in the computer's terms: the folder they are in, and the start of a name in it. */
export interface PathQuery {
  /** The folder the words are in, as a host path. */
  folder: string;
  /** The words up to and including that folder, as written, so a name goes on the end of them. */
  lead: string;
  /** The start of the name the words are reaching for; empty after a separator. */
  prefix: string;
}

const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * An address as a person types it: no scheme, no `www.`, no trailing slash.
 * What the field completes against and what its rows say under a title.
 */
export function bareAddress(url: string): string {
  return url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/**
 * The rest of an address the typed words are the start of, for the field to
 * write in ahead of the caret the way a browser's does. A site whole comes
 * before a page on it, so "git" becomes github.com rather than the last
 * issue read there; an address only once the words reach past its site.
 * Pages are newest first, and the newest that fits wins.
 */
export function addressCompletion(typed: string, pages: KnownPage[]): string {
  if (!typed || /\s/.test(typed)) {
    return "";
  }
  const lower = typed.toLowerCase().replace(/^www\./, "");
  if (lower === "") {
    return "";
  }
  const addresses = pages.map((page) => bareAddress(page.url));
  const sites = addresses.map((address) => address.split("/")[0] ?? address);
  const found =
    sites.find((site) => site.toLowerCase().startsWith(lower)) ??
    addresses.find((address) => address.toLowerCase().startsWith(lower));
  return found ? found.slice(lower.length) : "";
}

/**
 * The pages the words find, best first: those whose address starts with the
 * words, then those whose every word is somewhere in the title or the
 * address, each newest first. Words, not scattered letters: a page found by
 * three letters strewn through its title is not one anyone was reaching for.
 */
export function matchPages<T extends KnownPage>(
  typed: string,
  pages: T[],
): T[] {
  const lower = typed.trim().toLowerCase();
  if (!lower) {
    return [];
  }
  const terms = lower.split(/\s+/);
  const leading: T[] = [];
  const containing: T[] = [];
  for (const page of pages) {
    const address = bareAddress(page.url).toLowerCase();
    if (address.startsWith(lower)) {
      leading.push(page);
      continue;
    }
    const haystack = `${page.title} ${address}`.toLowerCase();
    if (terms.every((term) => haystack.includes(term))) {
      containing.push(page);
    }
  }
  return [...leading, ...containing];
}

/**
 * Things in a list the words name, best first: a name the words start, then
 * one with a word the words start, then one holding the words anywhere, then
 * one holding the words' letters in order and close together, which is the
 * matcher the app's other searches use.
 */
export function matchNames<T>(
  typed: string,
  items: T[],
  nameOf: (item: T) => string,
): T[] {
  const lower = typed.trim().toLowerCase();
  if (!lower) {
    return [];
  }
  const names = items.map((item) => nameOf(item).toLowerCase());
  const tier = (name: string) =>
    name.startsWith(lower)
      ? 0
      : name.split(/[\s\-_./]+/).some((word) => word.startsWith(lower))
        ? 1
        : name.includes(lower)
          ? 2
          : undefined;
  const loose = new Set(fuzzy.filter(names, lower) ?? []);
  return items
    .map((item, index) => ({
      item,
      rank: tier(names[index] ?? "") ?? (loose.has(index) ? 3 : undefined),
    }))
    .filter(
      (entry): entry is { item: T; rank: number } => entry.rank !== undefined,
    )
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

/**
 * Typed words that are a place on the computer: a path from the root, from
 * the home folder as `~`, or from a drive letter, the way the field shows one.
 * A trailing slash says nothing about a folder the field will open anyway.
 */
export function pathFromWords(words: string): string | undefined {
  if (!/^(?:~(?:\/|$)|\/|[A-Z]:[\\/])/i.test(words)) {
    return;
  }
  return words.length > 1 ? words.replace(/[\\/]+$/, "") || words[0] : words;
}

/**
 * Typed words as a place on the computer, the way a folder window's own path
 * field reads them: whole from the root, the home folder or a drive, and
 * otherwise from the folder the field is over, so a name typed bare is one in
 * that folder.
 */
export function pathQuery(
  typed: string,
  { here, home }: { here: string; home: string },
): PathQuery {
  // The home folder on its own is a folder, not the start of a name in one.
  if (typed === "~") {
    return { folder: home, lead: "~/", prefix: "" };
  }
  const cut = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
  const lead = typed.slice(0, cut + 1);
  const prefix = typed.slice(cut + 1);
  const folder = hostPathOf(lead, { here, home });
  // A folder's own path, short of the separator a name would follow, unless
  // the separator is all there is of it: the root, or a drive's.
  return {
    folder: /^(?:[\\/]|[A-Z]:[\\/])$/i.test(folder)
      ? folder
      : folder.replace(/[\\/]+$/, ""),
    lead,
    prefix,
  };
}

/**
 * Written words as a host path: `~` is the home folder, a path from the root
 * or a drive stands as it is, and anything else is under `here`.
 */
export function hostPathOf(
  written: string,
  { here, home }: { here: string; home: string },
): string {
  const separator = here.includes("\\") && !here.includes("/") ? "\\" : "/";
  const absolute =
    written === "~" || /^~[\\/]/.test(written)
      ? `${home}${written.slice(1)}`
      : /^(?:\/|[A-Z]:[\\/])/i.test(written)
        ? written
        : written === ""
          ? here
          : `${here.replace(/[\\/]+$/, "")}${separator}${written}`;
  return resolveDots(absolute);
}

/**
 * The entries of a folder the start of a name reaches, best first: names it
 * starts, then names holding it, folders ahead of files in each, then by
 * name. Hidden entries only once the name typed starts the way theirs do.
 */
export function matchEntries<T extends ListedEntry>(
  prefix: string,
  entries: T[],
): T[] {
  const lower = prefix.toLowerCase();
  const showsHidden = prefix.startsWith(".");
  const visible = entries.filter(
    (entry) => showsHidden || (!entry.hidden && !entry.name.startsWith(".")),
  );
  const byKindThenName = (a: T, b: T) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : a.kind === "folder"
        ? -1
        : 1;
  const leading = visible
    .filter((entry) => entry.name.toLowerCase().startsWith(lower))
    .sort(byKindThenName);
  const containing = lower
    ? visible
        .filter(
          (entry) =>
            !entry.name.toLowerCase().startsWith(lower) &&
            entry.name.toLowerCase().includes(lower),
        )
        .sort(byKindThenName)
    : [];
  return [...leading, ...containing];
}

/** `.` and `..` walked out of a path, never above its root. */
function resolveDots(path: string): string {
  if (!/(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(path)) {
    return path;
  }
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const root = /^[A-Z]:[\\/]/i.test(path) ? path.slice(0, 3) : "/";
  const names: string[] = [];
  for (const name of path.slice(root.length).split(/[\\/]+/)) {
    if (name === "..") {
      names.pop();
    } else if (name !== "." && name !== "") {
      names.push(name);
    }
  }
  const trailing = /[\\/]$/.test(path) && names.length > 0 ? separator : "";
  return `${root}${names.join(separator)}${trailing}`;
}
