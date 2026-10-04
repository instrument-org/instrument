import {
  APP_CATEGORY_IDS,
  APP_FAMILY_IDS,
  searchDirectory,
} from "@instrument-org/shared/app-directory";
import { z } from "zod";

import catalogSeed from "./catalog-seed.json";

/**
 * A service the directory knows how to reach, one product per entry. Seed data
 * is curated by hand and checked in, so the directory works offline and
 * instantly.
 */
const AppCatalogEntrySchema = z.object({
  /**
   * For a service reached through its REST API, what its guide needs beyond
   * the description: the endpoints a request reaches for, what a request has
   * to get right, and the cheap GET that proves a key. An MCP server's tools
   * describe themselves, so an entry reached that way has none.
   */
  apiGuide: z
    .object({
      conventions: z.string(),
      endpoints: z.string(),
      test: z.string(),
    })
    .optional(),
  authMethods: z.array(
    z.object({
      label: z.string(),
      note: z.string().optional(),
      type: z.enum(["api_key", "oauth2", "pat", "token"]),
    }),
  ),
  /** Other names a person calls the product by: "jira" for Atlassian, "excel" for OneDrive. */
  aliases: z.array(z.string()).optional(),
  category: z.literal(APP_CATEGORY_IDS),
  description: z.string(),
  docsUrl: z.string().optional(),
  domain: z.string(),
  /** The vendor whose products sign in together, when it has several. */
  family: z.literal(APP_FAMILY_IDS).optional(),
  /** The signed-in web app, when it is not the domain's front page. */
  home: z.string().optional(),
  /**
   * The ways in, tried in the order `app catalog` describes: a hosted MCP
   * server, one that runs here, an API a key opens, the Mac's own app, and
   * last the web app at `home`.
   */
  interfaces: z.array(
    z.object({
      auth: z.string().optional(),
      /** For the Mac's own app (`format: "mac-app"`), which app. */
      bundleId: z.string().optional(),
      endpoint: z.string().optional(),
      format: z.string(),
      name: z.string(),
      /** For a server that runs on this machine, what to install. */
      package: z.string().optional(),
      runtime: z.enum(["node", "python"]).optional(),
    }),
  ),
  name: z.string(),
  /**
   * Position in public usage (the better of Zapier's app popularity and the
   * Claude connector directory's order), hand-set for the Mac's own apps;
   * lower is used more. Orders browsing and breaks ties in search.
   */
  rank: z.number().optional(),
  slug: z.string(),
  tagline: z.string(),
  /** Featured leads the Apps page; hidden is found only by its name. */
  tier: z.enum(["featured", "hidden", "listed"]),
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
 * An interface's `auth` when its sign-in needs an OAuth client registered
 * with the vendor ahead of time, which Instrument does not have yet: the
 * server registers no client on the spot, so the sign-in card cannot make
 * one. Such a server is skipped for the next way in.
 */
const NEEDS_REGISTERED_CLIENT = "oauth-client";

/**
 * The entry's hosted MCP server, when it has one the sign-in card or a key
 * can open: the interface the agent should reach for first, since sign-in,
 * refresh, and the tool list all come with it.
 */
export function catalogEntryMcpEndpoint(
  entry: AppCatalogEntry,
): string | undefined {
  return entry.interfaces.find(
    (surface) =>
      surface.format === "mcp" &&
      surface.endpoint &&
      surface.auth !== NEEDS_REGISTERED_CLIENT,
  )?.endpoint;
}

/** True when an entry offers a simple key or token path beside OAuth. */
export function catalogEntrySupportsApiKey(entry: AppCatalogEntry): boolean {
  return entry.authMethods.some((method) =>
    ["api_key", "pat", "token"].includes(method.type),
  );
}

/**
 * The directory's entry for an app being set up: the one its slug names, or
 * failing that the one whose endpoint it points at, since the agent picks the
 * slug and the endpoint comes from the directory's own set-up line.
 */
export function findCatalogEntry(
  slug: string,
  endpoint: string | undefined,
): AppCatalogEntry | undefined {
  const catalog = getAppCatalog();
  return (
    catalog.find((entry) => entry.slug === slug) ??
    (endpoint === undefined
      ? undefined
      : catalog.find((entry) =>
          entry.interfaces.some((surface) => surface.endpoint === endpoint),
        ))
  );
}

/** The built-in directory, parsed and validated once. */
export function getAppCatalog(): AppCatalogEntry[] {
  cached ??= CatalogSeedSchema.parse(catalogSeed).entries;
  return cached;
}

/**
 * Entries matching every word given, the ones the words name before the ones
 * that only mention them, then by use (`searchDirectory`). With no words, the
 * directory a person browses, most used first.
 */
export function searchAppCatalog(query: string): AppCatalogEntry[] {
  return searchDirectory(getAppCatalog(), query);
}

/**
 * The Mac app an entry is worked through when that is its way in: the Mac's
 * own apps, and a service a Mac app reads (Gmail through Mail) until its own
 * sign-in client clears.
 */
export function catalogEntryMacApp(
  entry: AppCatalogEntry,
): undefined | { bundleId: string; name: string } {
  const surface = entry.interfaces.find(
    (candidate) => candidate.format === "mac-app" && candidate.bundleId,
  );
  return surface?.bundleId
    ? { bundleId: surface.bundleId, name: surface.name }
    : undefined;
}
