import {
  APP_CATEGORIES,
  APP_CATEGORY_IDS,
  APP_FAMILY_IDS,
  searchDirectory,
} from "@instrument-org/shared/app-directory";
import { z } from "zod";

import { askDecisionModel } from "../decision-model";

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
  /**
   * Everyday requests a person might make of the agent once the service is
   * connected, phrased the way they would type them. The app's page offers
   * them as one-press asks.
   */
  examples: z.array(z.string()).optional(),
  /** The vendor whose products sign in together, when it has several. */
  family: z.literal(APP_FAMILY_IDS).optional(),
  /** The signed-in web app, when it is not the domain's front page. */
  home: z.string().optional(),
  /**
   * Where signing in on the web starts, when that is not `home`: signed out,
   * a service's home is often its marketing page, with the sign-in a click
   * away the user should not have to find.
   */
  signIn: z.string().optional(),
  /**
   * Where signing in a second account on the web starts, for a vendor whose
   * browser session holds several at once: the vendor's own "add another
   * account" page, since its sign-in page goes straight to the account
   * already signed in.
   */
  addAccount: z.string().optional(),
  /**
   * The web app as one signed-in account sees it, with `{account}` where the
   * account goes, for a vendor whose session holds several: the address that
   * keeps a second account's tasks in that account rather than the first.
   */
  accountHome: z.string().optional(),
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
      /**
       * For `auth: "oauth-client"`, the client Instrument registered with the
       * vendor: a public PKCE client, so the id is no secret. Its sign-in
       * comes back through our API's relay, the only https redirect the
       * vendor accepts.
       */
      clientId: z.string().optional(),
      endpoint: z.string().optional(),
      format: z.string(),
      /**
       * For a key or token, the page where the account holder makes one. A
       * key is offered as the way in only with it, since a key the user
       * cannot find (a bot token that takes building an app first) strands
       * them at the card.
       */
      keyPage: z.string().optional(),
      /** What to do on `keyPage`, in a sentence the key card shows. */
      keySteps: z.string().optional(),
      /** For the Mac's own app, what a task can and cannot do in it, said before it tries. */
      limits: z.string().optional(),
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
  /**
   * The server's name in the official MCP Registry, when the vendor publishes
   * one there: what the registry sync joins on to report a changed endpoint.
   */
  registryName: z.string().optional(),
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

type CatalogInterface = AppCatalogEntry["interfaces"][number];

/**
 * Whether an interface's sign-in needs an OAuth client registered with the
 * vendor ahead of time (`auth: "oauth-client"`) and Instrument has none for
 * it: the server registers no client on the spot, so the sign-in card cannot
 * make one. Such a server is skipped for the next way in.
 */
export function catalogInterfaceLacksClient(
  surface: CatalogInterface,
): boolean {
  return surface.auth === "oauth-client" && surface.clientId === undefined;
}

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
      !catalogInterfaceLacksClient(surface),
  )?.endpoint;
}

function sameEndpoint(a: string, b: string | undefined): boolean {
  return a.replace(/\/+$/, "") === b?.replace(/\/+$/, "");
}

/** Whether an endpoint is one the directory knows needs a registered sign-in client it does not have. */
export function catalogEndpointNeedsClient(endpoint: string): boolean {
  return getAppCatalog().some((entry) =>
    entry.interfaces.some(
      (surface) =>
        catalogInterfaceLacksClient(surface) &&
        sameEndpoint(endpoint, surface.endpoint),
    ),
  );
}

/**
 * Instrument's own sign-in client for an MCP server, when the directory has
 * one for exactly that endpoint, with the service whose relay route the
 * sign-in comes back through. Matched on the endpoint rather than the app's
 * slug, so the client is only ever offered to the server it was issued for.
 */
export function catalogRegisteredClient(
  endpoint: string,
): undefined | { clientId: string; service: string } {
  for (const entry of getAppCatalog()) {
    for (const surface of entry.interfaces) {
      if (
        surface.format === "mcp" &&
        surface.auth === "oauth-client" &&
        surface.clientId !== undefined &&
        sameEndpoint(endpoint, surface.endpoint)
      ) {
        return { clientId: surface.clientId, service: entry.slug };
      }
    }
  }
  return undefined;
}

/**
 * Where the key for an app's endpoint is made, and what to do there, when
 * the directory knows: what the key card shows beside the field.
 */
export function catalogKeyHelp(
  slug: string,
  endpoint: string,
): undefined | { page: string; steps?: string } {
  const surface = findCatalogEntry(slug, endpoint)?.interfaces.find(
    (candidate) => candidate.keyPage !== undefined,
  );
  return surface?.keyPage
    ? {
        page: surface.keyPage,
        ...(surface.keySteps ? { steps: surface.keySteps } : {}),
      }
    : undefined;
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

/**
 * The directory's entry for a web address: the one whose signed-in web app
 * the address is in, the longest such app winning so a page of
 * docs.google.com/spreadsheets is Sheets and not Docs; failing that, the one
 * entry on the address's host. A second account of a service lives at its
 * own address of the same site (mail.google.com/mail/u/1/), which is how it
 * is still that service.
 */
export function catalogEntryAt(address: string): AppCatalogEntry | undefined {
  const url = URL.parse(address);
  if (url === null) {
    return undefined;
  }
  const catalog = getAppCatalog();
  const homeOf = (entry: AppCatalogEntry) =>
    URL.parse(entry.home ?? `https://${entry.domain}`);
  const within = catalog
    .map((entry) => ({ entry, home: homeOf(entry) }))
    .filter(
      ({ home }) =>
        home !== null &&
        home.host === url.host &&
        url.pathname.startsWith(home.pathname.replace(/\/+$/, "")),
    )
    .sort(
      (a, b) => (b.home?.pathname.length ?? 0) - (a.home?.pathname.length ?? 0),
    );
  if (within[0]) {
    return within[0].entry;
  }
  const onHost = catalog.filter(
    (entry) => entry.domain === url.host || homeOf(entry)?.host === url.host,
  );
  return onHost.length === 1 ? onHost[0] : undefined;
}

/**
 * The directory's entry for an app already set up: the service its manifest
 * names, else the one its slug or address finds. Every app of one service
 * answers the same entry whatever its slug, so two Gmail accounts are both
 * Gmail.
 */
export function catalogEntryForApp(
  slug: string,
  manifest: { service?: string | undefined; type: string; url?: string },
): AppCatalogEntry | undefined {
  const catalog = getAppCatalog();
  const named =
    manifest.service === undefined
      ? undefined
      : catalog.find((entry) => entry.slug === manifest.service);
  return (
    named ??
    findCatalogEntry(
      slug,
      manifest.type === "mcp" ? manifest.url : undefined,
    ) ??
    (manifest.type === "web" && manifest.url !== undefined
      ? catalogEntryAt(manifest.url)
      : undefined)
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

/** Below this chance a service is not offered as what a search meant. */
const MEANT_AT_LEAST = 0.6;
/**
 * How far below the best fit a service may score and still be offered: the
 * scale each model scores on drifts with the query, so what counts as a fit
 * is judged against the best one rather than alone.
 */
const MEANT_WITHIN = 0.2;
/** How many services a search by meaning offers. */
const MEANT_SHOWN = 8;

/**
 * Services a search means without naming them, asked of the decision model:
 * "text my mom" is Apple Messages, "track my runs" Strava, "design tool"
 * Figma and Canva and the whiteboards, none of which the words spell. Each
 * service is asked about on its own, so a search several of them fit offers
 * them all rather than the single likeliest. Best fit first, only those
 * close to it, and nothing when no provider reaches the model or the call
 * fails, so a caller treats it as a bonus over the search by words.
 */
export async function searchAppCatalogByMeaning(
  query: string,
  {
    configs,
    signal,
  }: {
    configs: Parameters<typeof askDecisionModel>[0]["configs"];
    signal?: AbortSignal;
  },
): Promise<AppCatalogEntry[]> {
  const browsed = getAppCatalog().filter((entry) => entry.tier !== "hidden");
  const bySlug = new Map(browsed.map((entry) => [entry.slug, entry]));
  try {
    const asked = await askDecisionModel({
      body: appMeaningRequest(query, browsed),
      configs,
      signal,
    });
    return pickMeant(asked?.response.answers ?? {}).flatMap((slug) => {
      const entry = bySlug.get(slug);
      return entry ? [entry] : [];
    });
  } catch {
    return [];
  }
}

/** The decision request a search by meaning makes: one yes-or-no per service, keyed by slug. */
export function appMeaningRequest(query: string, entries: AppCatalogEntry[]) {
  return {
    questions: Object.fromEntries(
      entries.map((entry) => [
        entry.slug,
        {
          criteria: {
            false: "It does not fit what they typed",
            true: "It is a service the person could be looking for, by name or by what it does",
          },
          // The tagline and category, not the longer description: in
          // trials the description's detail pulled scores toward
          // incidental words and away from what the service is.
          instructions: `Would ${describeForMeaning(entry)} be a useful result for what the person typed into an app directory's search box?`,
          type: "noul" as const,
        },
      ]),
    ),
    state: { query },
  };
}

/** The slugs a search by meaning offers, best fit first and only those close to it. */
export function pickMeant(
  answers: Record<string, { noul?: number }>,
): string[] {
  const fits = Object.entries(answers)
    .flatMap(([slug, answer]) =>
      answer.noul === undefined ? [] : [{ chance: answer.noul, slug }],
    )
    .sort((a, b) => b.chance - a.chance);
  const best = fits[0]?.chance ?? 0;
  return fits
    .filter(
      ({ chance }) => chance >= MEANT_AT_LEAST && chance >= best - MEANT_WITHIN,
    )
    .slice(0, MEANT_SHOWN)
    .map(({ slug }) => slug);
}

/** A service as the decision model weighs it: name, category, what it is for, and what else it is called. */
function describeForMeaning(entry: AppCatalogEntry): string {
  const category =
    APP_CATEGORIES.find(({ id }) => id === entry.category)?.label ??
    entry.category;
  const aliases = entry.aliases?.length
    ? ` Also called ${entry.aliases.join(", ")}.`
    : "";
  return `${entry.name} (${category}): ${entry.tagline}${aliases}`;
}
