import { z } from "zod";

import catalogSeed from "./catalog-seed.json";

/**
 * A service the directory knows how to reach. Seed data is a curated snapshot
 * of a public integrations index, cached locally so the directory works
 * offline and instantly; a live refresh can layer on top later without
 * changing this shape.
 */
const AppCatalogEntrySchema = z.object({
  authMethods: z.array(
    z.object({
      label: z.string(),
      note: z.string().optional(),
      type: z.enum(["api_key", "oauth2", "pat", "token"]),
    }),
  ),
  categories: z.array(z.string()),
  description: z.string(),
  docsUrl: z.string().optional(),
  domain: z.string(),
  /** The signed-in web app, when it is not the domain's front page. */
  home: z.string().optional(),
  interfaces: z.array(
    z.object({
      auth: z.string().optional(),
      endpoint: z.string().optional(),
      format: z.string(),
      name: z.string(),
      /** For a server that runs on this machine, what to install. */
      package: z.string().optional(),
      runtime: z.enum(["node", "python"]).optional(),
    }),
  ),
  name: z.string(),
  slug: z.string(),
  tagline: z.string(),
});

export type AppCatalogEntry = z.output<typeof AppCatalogEntrySchema>;

const CatalogSeedSchema = z.object({
  entries: z.array(AppCatalogEntrySchema),
});

let cached: AppCatalogEntry[] | undefined;

/**
 * The entry's own MCP server that runs on this machine, when it has one: for
 * a service with no cloud API, this is the only way in.
 */
export function catalogEntryLocalServer(
  entry: AppCatalogEntry,
): undefined | { package: string; runtime: "node" | "python" } {
  const surface = entry.interfaces.find(
    (candidate) => candidate.format === "mcp-local" && candidate.package,
  );
  return surface?.package
    ? { package: surface.package, runtime: surface.runtime ?? "node" }
    : undefined;
}

/**
 * The entry's hosted MCP endpoint, when it has one: the interface the agent
 * should reach for first, since sign-in, refresh, and the tool list all come
 * with it.
 */
export function catalogEntryMcpEndpoint(
  entry: AppCatalogEntry,
): string | undefined {
  return entry.interfaces.find(
    (surface) => surface.format === "mcp" && surface.endpoint,
  )?.endpoint;
}

/** True when an entry offers a simple key or token path beside OAuth. */
export function catalogEntrySupportsApiKey(entry: AppCatalogEntry): boolean {
  return entry.authMethods.some((method) =>
    ["api_key", "pat", "token"].includes(method.type),
  );
}

/** The built-in directory, parsed and validated once. */
export function getAppCatalog(): AppCatalogEntry[] {
  cached ??= CatalogSeedSchema.parse(catalogSeed).entries;
  return cached;
}

/**
 * Entries whose slug, name, domain, tagline, or category carries every word
 * given, the ones the query names before the ones that merely mention it.
 */
export function searchAppCatalog(query: string): AppCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return getAppCatalog();
  }
  return getAppCatalog()
    .filter((entry) => {
      const haystack = [
        entry.slug,
        entry.name,
        entry.domain,
        entry.tagline,
        ...entry.categories,
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map((entry) => ({ entry, tier: matchTier(entry, needle) }))
    .sort((a, b) => a.tier - b.tier || a.entry.slug.localeCompare(b.entry.slug))
    .map(({ entry }) => entry);
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
 * The agent searches by a service's name, so an entry that *is* the thing asked
 * for has to come back ahead of one that only mentions it in passing: "paper"
 * matches Consensus, whose tagline reads "read what the papers found", and
 * matched it ahead of Paper while the order was the catalog's own.
 */
function matchTier(entry: AppCatalogEntry, needle: string): number {
  const slug = entry.slug.toLowerCase();
  const name = entry.name.toLowerCase();
  const domain = entry.domain.toLowerCase();
  // The domain's own label -- "paper" out of paper.design -- so a service the
  // query names reaches its entry whether or not the slug spells it that way.
  // The suffix stays out of the tiers below it: matching that, "ai" would rank
  // every .ai company and "app" every .app one, on nothing but a TLD.
  const label = domain.split(".")[0] ?? "";

  if (slug === needle || name === needle || label === needle) {
    return 0;
  }
  // A domain typed whole is still the service named outright.
  if (domain === needle) {
    return 0;
  }
  if (
    slug.startsWith(needle) ||
    name.startsWith(needle) ||
    label.startsWith(needle)
  ) {
    return 1;
  }
  if (
    containsWord(name, needle) ||
    containsWord(slug.replaceAll("-", " "), needle)
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
