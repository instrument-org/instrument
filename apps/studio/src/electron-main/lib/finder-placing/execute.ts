import {
  type Identity,
  identityOf,
  type NewJournalEntry,
  restoreFromTrash,
  type Trashed,
} from "../file-journal";
import { renameExclusive } from "../exclusive-rename";
import { renameExclusive as nativeRenameExclusive } from "../mac-native";
import { sameIdentity, STAGING_PREFIX, type Step } from "./plan";
import fs from "node:fs/promises";
import path from "node:path";

/** How much a thing holds, counted without following links: what a copy is checked against. */
type Measure = {
  bytes: number;
  files: number;
  folders: number;
  links: number;
};

/**
 * What carrying out a plan does to the file system, as one seam: the real
 * thing in the app, a stand-in Trash and injected failures in a test.
 */
export type PlacingOps = {
  /** Copies a thing to a path nothing is at, links as links. */
  copy: (from: string, to: string) => Promise<void>;
  identity: (at: string) => Promise<Identity | null>;
  measure: (at: string) => Promise<Measure>;
  /** Puts a thing at a path nothing is at, failing when something is. */
  place: (from: string, to: string) => Promise<void>;
  /** Takes away a staging copy this made, and nothing else. */
  removeStaging: (at: string) => Promise<void>;
  /** Puts something the step in hand trashed back where it was. */
  restore: (item: Trashed) => Promise<void>;
  /** Moves a thing to the Trash, saying where it landed. */
  trash: (at: string) => Promise<null | Trashed>;
};

/** What was placed, for the toast and the selection. */
type Placed = {
  from: string;
  how: "copied" | "moved";
  path: string;
  replaced: boolean;
};

export type PlacingOutcome = {
  /** Why it stopped short, and what that left where, when it did. */
  failure: null | string;
  /** What undoes everything that was done; null when nothing was. */
  journal: NewJournalEntry | null;
  placed: Placed[];
  /** Sources left where they were: answered Skip, or changed since the plan. */
  skipped: { source: string; why: "answered" | "changed" }[];
};

const nameOf = (at: string) => `“${path.basename(at)}”`;

/**
 * Carries out a plan's steps in order, and nothing the plan does not say.
 * Each placed item goes: its copy staged and measured (a copy), what it
 * replaces to the Trash, then itself into place exclusively. A step that
 * fails puts its own item
 * back as it was and stops the rest; what was done before it is journaled.
 * See `plan.ts` for the invariants this keeps.
 */
export async function executePlacing(
  op: "copy" | "move",
  steps: readonly Step[],
  ops: PlacingOps,
): Promise<PlacingOutcome> {
  const moved: { from: string; identity: Identity; to: string }[] = [];
  const made: { identity: Identity; path: string }[] = [];
  const replaced: Trashed[] = [];
  const placed: Placed[] = [];
  const skipped: PlacingOutcome["skipped"] = [];
  let failure: null | string = null;

  for (const step of steps) {
    if (step.kind === "skip") {
      if (step.why === "answered") {
        skipped.push({ source: step.source, why: "answered" });
      }
      continue;
    }
    const now = await ops.identity(step.source);
    if (!now || !sameIdentity(now, step.sourceIdentity)) {
      skipped.push({ source: step.source, why: "changed" });
      continue;
    }

    let staged: null | string = null;
    let trashedHere: null | Trashed = null;
    let isPlaced = false;
    try {
      if (step.staging !== null) {
        await ops.copy(step.source, step.staging);
        staged = step.staging;
        const [original, copy] = await Promise.all([
          ops.measure(step.source),
          ops.measure(step.staging),
        ]);
        if (JSON.stringify(original) !== JSON.stringify(copy)) {
          throw new Error(
            `The copy of ${nameOf(step.source)} came out different from it.`,
          );
        }
      }
      if (step.replaces) {
        const there = await ops.identity(step.replaces.path);
        if (!there || !sameIdentity(there, step.replaces.identity)) {
          throw new Error(
            `${nameOf(step.replaces.path)} changed after you chose to replace it.`,
          );
        }
        trashedHere = await ops.trash(step.replaces.path);
        if (!trashedHere) {
          throw new Error(
            `${nameOf(step.replaces.path)} couldn’t be moved to the Trash.`,
          );
        }
      }
      await ops.place(staged ?? step.source, step.to);
      isPlaced = true;
      staged = null;
      const identity = await ops.identity(step.to);
      if (trashedHere) {
        replaced.push(trashedHere);
        trashedHere = null;
      }
      if (step.how === "rename") {
        if (identity) {
          moved.push({ from: step.source, identity, to: step.to });
        }
        placed.push({
          from: step.source,
          how: "moved",
          path: step.to,
          replaced: step.replaces !== null,
        });
        continue;
      }
      if (identity) {
        made.push({ identity, path: step.to });
      }
      placed.push({
        from: step.source,
        how: "copied",
        path: step.to,
        replaced: step.replaces !== null,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (isPlaced) {
        // In place; only what follows it failed.
        failure = `${nameOf(step.to)} is in place, but then: ${failure}`;
        break;
      }
      // Back as it was: what it replaced out of the Trash, its copy gone.
      if (trashedHere) {
        try {
          await ops.restore(trashedHere);
        } catch {
          failure += ` ${nameOf(trashedHere.from)} is in the Trash.`;
          replaced.push(trashedHere);
        }
      }
      if (staged !== null) {
        await ops.removeStaging(staged).catch(() => undefined);
      }
      break;
    }
  }

  const anything = moved.length + made.length + replaced.length > 0;
  return {
    failure,
    journal: !anything
      ? null
      : op === "copy"
        ? { kind: "copy", made, replaced }
        : { kind: "move", made, moved, replaced },
    placed,
    skipped,
  };
}

/** Counts what a thing holds without following a link, for checking a copy. */
async function measure(at: string): Promise<Measure> {
  const total: Measure = { bytes: 0, files: 0, folders: 0, links: 0 };
  const visit = async (here: string) => {
    const stats = await fs.lstat(here);
    if (stats.isSymbolicLink()) {
      total.links += 1;
    } else if (stats.isDirectory()) {
      total.folders += 1;
      for (const name of await fs.readdir(here)) {
        await visit(path.join(here, name));
      }
    } else {
      total.files += 1;
      total.bytes += stats.size;
    }
  };
  await visit(at);
  return total;
}

/** Whether an error says the file system cannot make a hard link here. */
function cannotLink(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "EXDEV" ||
    code === "EPERM" ||
    code === "ENOTSUP" ||
    code === "EMLINK" ||
    code === "ENOSYS"
  );
}

/**
 * The file system's own ops. Placing is an exclusive rename on the Mac; on
 * the other systems a file goes by a hard link and anything else by
 * `renameExclusive`, which says what that leaves open.
 */
export function fileSystemOps({
  trash,
}: {
  trash: (at: string) => Promise<null | Trashed>;
}): PlacingOps {
  return {
    copy: (from, to) =>
      fs.cp(from, to, {
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      }),
    identity: identityOf,
    measure,
    place: async (from, to) => {
      // In one step where the disk can: the Mac's exclusive rename.
      if (await nativeRenameExclusive(from, to)) {
        return;
      }
      // Elsewhere a file goes by a hard link, which fails when the name is
      // taken, then lets go of its old name; if that fails, the new name is
      // taken back, so the file is never left in both places.
      const stats = await fs.lstat(from);
      if (stats.isFile()) {
        const linked = await fs.link(from, to).then(
          () => true,
          (error: unknown) => {
            if (cannotLink(error)) {
              return false;
            }
            throw error;
          },
        );
        if (linked) {
          try {
            await fs.unlink(from);
          } catch (error) {
            await fs.unlink(to).catch(() => undefined);
            throw error;
          }
          return;
        }
      }
      await renameExclusive(from, to);
    },
    removeStaging: async (at) => {
      if (!path.basename(at).startsWith(STAGING_PREFIX)) {
        throw new Error(`Not a staging copy: ${at}`);
      }
      await fs.rm(at, { force: true, recursive: true });
    },
    restore: (item) => restoreFromTrash(item),
    trash,
  };
}
