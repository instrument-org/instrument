/**
 * The app directory's order, grouping, and search, shared so the agent's
 * `app catalog` and the Apps page find and rank services the same way.
 */

/** The directory's categories, in the order the Apps page lists them. */
export const APP_CATEGORIES = [
  { id: "mail", label: "Mail & messages" },
  { id: "calendar", label: "Calendar & meetings" },
  { id: "notes", label: "Notes & docs" },
  { id: "files", label: "Files" },
  { id: "tasks", label: "Tasks & projects" },
  { id: "design", label: "Design & creative" },
  { id: "sales", label: "Sales & customers" },
  { id: "marketing", label: "Marketing" },
  { id: "money", label: "Money" },
  { id: "stores", label: "Stores & websites" },
  { id: "data", label: "Data & analytics" },
  { id: "research", label: "Research" },
  { id: "life", label: "Life & leisure" },
  { id: "automation", label: "Automation" },
  { id: "developer", label: "Developer tools" },
] as const;

export type AppCategory = (typeof APP_CATEGORIES)[number]["id"];

export const APP_CATEGORY_IDS: AppCategory[] = APP_CATEGORIES.map(
  ({ id }) => id,
);

/**
 * Vendors whose products are listed one by one but sign in together, by the
 * name a person calls the vendor.
 */
export const APP_FAMILIES = {
  apple: "Apple",
  atlassian: "Atlassian",
  google: "Google",
  microsoft: "Microsoft",
} as const;

export type AppFamily = keyof typeof APP_FAMILIES;

export const APP_FAMILY_IDS: AppFamily[] = [
  "apple",
  "atlassian",
  "google",
  "microsoft",
];

/** What ordering and search read of an entry. */
export interface DirectoryListing {
  aliases?: string[] | undefined;
  category: AppCategory;
  domain: string;
  family?: AppFamily | undefined;
  name: string;
  /** Position in public usage; lower is used more. Absent when no ranking lists it. */
  rank?: number | undefined;
  slug: string;
  tagline: string;
  /** Featured leads, listed follows, hidden is found only by its name. */
  tier: "featured" | "hidden" | "listed";
}

/**
 * The entries a person browses, most used first: featured, then the rest,
 * each by public usage, the unranked last by name. Hidden entries are left
 * out; a search that names one still finds it.
 */
export function directoryByUse<T extends DirectoryListing>(entries: T[]): T[] {
  return entries.filter((entry) => entry.tier !== "hidden").toSorted(byUse);
}

/**
 * Entries matching every word typed, the ones the words name before the ones
 * that only mention them, then by use. A hidden entry comes back only when
 * the words are its name or an alias, so a documentation server never crowds a search for the
 * product it documents.
 */
export function searchDirectory<T extends DirectoryListing>(
  entries: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return directoryByUse(entries);
  }
  return entries
    .filter((entry) => {
      const haystack = [
        entry.slug,
        entry.name,
        entry.domain,
        entry.tagline,
        ...(entry.aliases ?? []),
        entry.family ? APP_FAMILIES[entry.family] : "",
        APP_CATEGORIES.find(({ id }) => id === entry.category)?.label ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map((entry) => ({ entry, tier: matchTier(entry, needle) }))
    .filter(({ entry, tier }) => entry.tier !== "hidden" || tier === 0)
    .sort((a, b) => a.tier - b.tier || byUse(a.entry, b.entry))
    .map(({ entry }) => entry);
}

function byUse(a: DirectoryListing, b: DirectoryListing): number {
  const featured =
    Number(b.tier === "featured") - Number(a.tier === "featured");
  if (featured !== 0) {
    return featured;
  }
  const rank =
    (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY);
  return Number.isNaN(rank) || rank === 0 ? a.name.localeCompare(b.name) : rank;
}

/** True when the needle sits in the text on both its boundaries. */
function containsWord(text: string, needle: string): boolean {
  for (
    let at = text.indexOf(needle);
    at !== -1;
    at = text.indexOf(needle, at + 1)
  ) {
    const before = text[at - 1];
    const after = text[at + needle.length];
    if (
      (before === undefined || !/[a-z0-9]/.test(before)) &&
      (after === undefined || !/[a-z0-9]/.test(after))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How closely an entry's own identity answers the query, best tier first.
 *
 * A search names a service, so an entry that *is* the thing asked for comes
 * back ahead of one that only mentions it: "paper" matches Consensus, whose
 * tagline reads "read what the papers found", and has to reach Paper first.
 * A name a person calls the product by ("jira", "excel") is as good as its
 * own; the vendor's name ("google") reaches every product it signs in to.
 */
function matchTier(entry: DirectoryListing, needle: string): number {
  const slug = entry.slug.toLowerCase();
  const name = entry.name.toLowerCase();
  const domain = entry.domain.toLowerCase();
  const aliases = (entry.aliases ?? []).map((alias) => alias.toLowerCase());
  const family = entry.family ? APP_FAMILIES[entry.family].toLowerCase() : "";
  // The domain's own label -- "paper" out of paper.design -- so a service the
  // query names reaches its entry whether or not the slug spells it that way.
  // The suffix stays out: matching that, "ai" would rank every .ai company.
  const label = domain.split(".")[0] ?? "";

  if (
    slug === needle ||
    name === needle ||
    label === needle ||
    domain === needle ||
    aliases.includes(needle)
  ) {
    return 0;
  }
  if (
    family === needle ||
    slug.startsWith(needle) ||
    name.startsWith(needle) ||
    label.startsWith(needle) ||
    aliases.some((alias) => alias.startsWith(needle))
  ) {
    return 1;
  }
  if (
    containsWord(name, needle) ||
    containsWord(slug.replaceAll("-", " "), needle) ||
    aliases.some((alias) => containsWord(alias, needle))
  ) {
    return 2;
  }
  if (
    slug.includes(needle) ||
    name.includes(needle) ||
    label.includes(needle)
  ) {
    return 3;
  }
  return 4;
}
