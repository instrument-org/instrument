/**
 * Moves the app directory's revision to now when its entries changed since it
 * was last stamped, so a build holding this seed refuses a served directory
 * older than it. Run after editing the entries; the catalog test fails until
 * it has been.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:stamp-app-catalog
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  AppCatalogDocumentSchema,
  appCatalogEntriesHash,
} from "../src/lib/apps/catalog";

const SEED = path.resolve(
  import.meta.dirname,
  "../src/lib/apps/catalog-seed.json",
);

const document: unknown = JSON.parse(await fs.readFile(SEED, "utf8"));
const parsed = AppCatalogDocumentSchema.parse(document);
const entriesHash = appCatalogEntriesHash(parsed.entries);
if (entriesHash === parsed.entriesHash) {
  console.log(`Unchanged since ${parsed.revision}.`);
} else {
  const revision = new Date().toISOString();
  await fs.writeFile(
    SEED,
    // Spread from the file as read, so its other fields and their order stay.
    `${JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(document), entriesHash, revision }, null, 2)}\n`,
  );
  console.log(`Stamped ${revision}.`);
}
