import { ResultAsync } from "neverthrow";
import superjson from "superjson";

import { type WrappedStorage } from "./wrap-storage";

/**
 * Where a task's stored data is brought up to what the current build expects.
 *
 * The alternative is a schema that tolerates every shape the data has ever had,
 * and that turned out to be the worse trade: a tolerant schema is only correct
 * if it sits on the path the data actually travels, and a stored part's path
 * skips validation entirely, so the tolerance can be tested, pass, and never
 * run. A migration has one call site, which makes "does this run" answerable by
 * reading one function.
 *
 * Rules for anything added here:
 *
 * - **Idempotent.** The version is written after the work, so a crash halfway
 *   through re-runs the whole migration on the next open. Detect the old shape
 *   and skip what is already current rather than assuming a clean slate; that is
 *   cheaper than a transaction the storage layer does not expose.
 * - **Self-contained.** A migration reads and writes stored data. It must not
 *   call into the schemas or helpers the rest of the app uses, because those
 *   describe today's shape and will move on without it.
 * - **Append-only.** Order is the array's order and the version is the count
 *   run. Inserting into the middle re-runs later migrations on some tasks and
 *   not others.
 */

/**
 * What a migration decides about one stored part: leave it, replace it with a
 * new value, or drop it. Spelled as a result rather than a sentinel value so
 * "the part is unchanged" cannot be confused with a part that happens to be a
 * string.
 */
type PartChange =
  | { kind: "remove" }
  | { kind: "replace"; part: unknown }
  | { kind: "unchanged" };

const UNCHANGED: PartChange = { kind: "unchanged" };

interface StoreMigration {
  name: string;
  run: (context: { storage: WrappedStorage }) => Promise<void>;
}

function replaceWith(part: unknown): PartChange {
  return { kind: "replace", part };
}

// A row in the task's own database, so it travels with the data it describes --
// through an export, an import, or a copied task folder. `__canary__` already
// establishes that the key space carries our own bookkeeping.
const VERSION_KEY = "__migration_version__";

const MIGRATIONS: StoreMigration[] = [
  {
    // Folders were stored under `name`, which was the mount name all along.
    name: "folder attachments carry mountName",
    run: async ({ storage }) => {
      await eachStoredPart(storage, (part) => {
        if (part.type !== "data-attachments" || !isRecord(part.data)) {
          return UNCHANGED;
        }
        if (!Array.isArray(part.data.folders)) {
          return UNCHANGED;
        }

        const folders: unknown[] = part.data.folders;
        const renamed = folders.map((folder): unknown => {
          if (
            !isRecord(folder) ||
            !("name" in folder) ||
            "mountName" in folder
          ) {
            return folder;
          }
          const { name, ...rest } = folder;
          return { ...rest, mountName: name };
        });

        return renamed.some((folder, index) => folder !== folders[index])
          ? replaceWith({ ...part, data: { ...part.data, folders: renamed } })
          : UNCHANGED;
      });
    },
  },
];

/**
 * Brings a task's database up to date, if it is behind.
 *
 * Runs at the one place a task's database is opened, before anything reads
 * through it. Cheap when there is nothing to do: one read of a single row.
 */
export function runStoreMigrations({
  storage,
}: {
  storage: WrappedStorage;
}): ResultAsync<void, Error> {
  return storage.getItemRaw<number>(VERSION_KEY).andThen((stored) => {
    const from = typeof stored === "number" ? stored : 0;
    const pending = MIGRATIONS.slice(from);
    // Nothing to run, and nothing to record either. A database carrying a
    // version this build has never heard of came from a newer one and is ahead
    // of us rather than behind: writing our own count over its marker would
    // leave that build reading its own task as stale and migrating it again.
    if (pending.length === 0) {
      return ResultAsync.fromSafePromise(Promise.resolve());
    }

    return ResultAsync.fromPromise(
      (async () => {
        for (const migration of pending) {
          await migration.run({ storage });
        }
      })(),
      (error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
    ).andThen(() => storage.setItemRaw(VERSION_KEY, MIGRATIONS.length));
  });
}

/** The stored value as the object it encodes, or undefined if it is neither. */
function decodeStoredValue(
  stored: unknown,
): Record<string, unknown> | undefined {
  const jsonString =
    typeof stored === "string"
      ? stored
      : Buffer.isBuffer(stored)
        ? stored.toString()
        : undefined;
  if (jsonString === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = superjson.parse(jsonString);
  } catch {
    // A part nothing can decode is a part nothing can migrate. Leaving it is
    // what the reader already does with it.
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

/**
 * Applies `transform` to every stored part, writing back only what changed.
 *
 * Reads the parts one at a time rather than all at once: a long task holds
 * thousands, and this runs while the caller is waiting to open the task.
 */
async function eachStoredPart(
  storage: WrappedStorage,
  transform: (
    part: Record<string, unknown>,
  ) => PartChange | Promise<PartChange>,
): Promise<void> {
  const keys = await storage.getKeys("parts");
  if (keys.isErr()) {
    throw keys.error;
  }

  for (const key of keys.value) {
    const stored = await storage.getItemRaw(key);
    if (stored.isErr()) {
      throw stored.error;
    }

    // Stored values are superjson strings, which is how the rest of the store
    // reads and writes them. A migration works below the schemas but not below
    // the encoding: writing a bare object here stores something no reader can
    // parse, and reading without decoding silently matches nothing.
    const encoded = decodeStoredValue(stored.value);
    if (encoded === undefined) {
      continue;
    }

    const change = await transform(encoded);
    if (change.kind === "unchanged") {
      continue;
    }

    const written =
      change.kind === "remove"
        ? await storage.removeItem(key)
        : await storage.setItemRaw(key, superjson.stringify(change.part));
    if (written.isErr()) {
      throw written.error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
