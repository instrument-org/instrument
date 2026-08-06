import { ResultAsync } from "neverthrow";
import superjson from "superjson";

import { type TaskDir } from "../schemas/paths";
import { type SessionMessageRelaxedPart } from "../schemas/session/message-relaxed-part";
import { migrateGitCommitPart } from "./migrate-git-commit-part";
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
const REMOVE: PartChange = { kind: "remove" };

interface StoreMigration {
  name: string;
  run: (context: {
    storage: WrappedStorage;
    taskDir: TaskDir;
  }) => Promise<void>;
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
  {
    // `gitCommit` parts predate the file-changes part that replaced them. The
    // rendering of them was a read-time translation that reached for git on
    // every read of an old session; done once, it can be stored instead.
    name: "gitCommit parts become fileChanges parts",
    run: async ({ storage, taskDir }) => {
      await eachStoredPart(storage, async (part) => {
        if (part.type !== "data-gitCommit") {
          return UNCHANGED;
        }
        // Cast: a stored part arrives as an unknown payload, and this reads the
        // shape it checked for above. `migrateGitCommitPart` validates `data`
        // itself and answers null when it does not recognize it.
        const dataPart = part as unknown as SessionMessageRelaxedPart.DataPart;
        // Null also covers a commit no longer in git history, where there is
        // nothing left to show and the part goes.
        const migrated = await migrateGitCommitPart(dataPart, taskDir);
        return migrated === null ? REMOVE : replaceWith(migrated);
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
  taskDir,
}: {
  storage: WrappedStorage;
  taskDir: TaskDir;
}): ResultAsync<void, Error> {
  return storage
    .getItemRaw<number>(VERSION_KEY)
    .andThen((stored) => {
      const from = typeof stored === "number" ? stored : 0;
      const pending = MIGRATIONS.slice(from);
      if (pending.length === 0) {
        return ResultAsync.fromSafePromise(Promise.resolve());
      }

      return ResultAsync.fromPromise(
        (async () => {
          for (const migration of pending) {
            await migration.run({ storage, taskDir });
          }
        })(),
        (error: unknown) =>
          error instanceof Error ? error : new Error(String(error)),
      );
    })
    .andThen(() => storage.setItemRaw(VERSION_KEY, MIGRATIONS.length));
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
