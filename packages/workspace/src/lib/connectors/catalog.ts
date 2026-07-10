import { z } from "zod";

import catalogSeed from "./catalog-seed.json";

/**
 * A discoverable connector in the built-in catalog. Seed data is a curated
 * snapshot of integrations.sh (see catalog-seed.json), cached locally so
 * discovery works offline and instantly; a live refresh against integrations.sh
 * can layer on top later without changing this shape.
 */
const ConnectorCatalogEntrySchema = z.object({
  authMethods: z.array(
    z.object({
      label: z.string(),
      note: z.string().optional(),
      type: z.string(),
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

export type ConnectorCatalogEntry = z.output<
  typeof ConnectorCatalogEntrySchema
>;

const CatalogSeedSchema = z.object({
  entries: z.array(ConnectorCatalogEntrySchema),
});

let cached: ConnectorCatalogEntry[] | undefined;

/** True when a catalog entry offers a simple API-key / token path. */
export function catalogEntrySupportsApiKey(
  entry: ConnectorCatalogEntry,
): boolean {
  return entry.authMethods.some((method) =>
    ["api_key", "pat", "token"].includes(method.type),
  );
}

/** The built-in connector catalog, parsed and validated once. */
export function getConnectorCatalog(): ConnectorCatalogEntry[] {
  cached ??= CatalogSeedSchema.parse(catalogSeed).entries;
  return cached;
}
