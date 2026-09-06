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
  interfaces: z.array(
    z.object({
      auth: z.string().optional(),
      endpoint: z.string().optional(),
      format: z.string(),
      name: z.string(),
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

/** Entries whose slug, name, domain, or category carries every word given. */
export function searchAppCatalog(query: string): AppCatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return getAppCatalog();
  }
  return getAppCatalog().filter((entry) => {
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
  });
}
