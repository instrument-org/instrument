import {
  type Identity,
  identityOf,
  type NewJournalEntry,
} from "../file-journal";
import { renameExclusive } from "../exclusive-rename";
import { renameExclusive as nativeRenameExclusive } from "../mac-native";
import { type Leftovers } from "./leftovers";
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

/** Where something moved to the Trash landed, when the system says; null when it does not. */
export type InTrash = { inTrash: null | string };

/**
 * What carrying out a plan does to the file system, as one seam: the real
 * thing in the app, a stand-in Trash and injected failures in a test.
 */
export type PlacingOps = {
  /** Copies a thing to a path nothing is at, links as links. */
  copy: (from: string, to: string) => Promise<void>;
  identity: (at: string) => Promise<Identity | null>;
  /** The record of staging copies, so a quit or crash mid-copy leaves none for good. */
  leftovers: Pick<Leftovers, "add" | "remove">;
  measure: (at: string) => Promise<Measure>;
  /** Puts a thing at a path nothing is at, failing when something is. */
  place: (from: string, to: string) => Promise<void>;
  /** Takes away a staging copy this made, and nothing else. */
  removeStaging: (at: string) => Promise<void>;
  /** Moves what a Replace displaces to the Trash. */
  trash: (at: string) => Promise<InTrash>;
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
  /**
   * What undoes everything that was done; null when nothing was, and when
   * anything was replaced, since what went to the Trash cannot be put back.
   */
  journal: NewJournalEntry | null;
  placed: Placed[];
  /** Sources left where they were: answered Skip, or changed since the plan. */
  skipped: { source: string; why: "answered" | "changed" }[];
  /** What a Replace moved to the Trash, by where it was and where it landed when known. */
  trashed: ({ from: string } & InTrash)[];
};

const nameOf = (at: string) => `“${path.basename(at)}”`;

/**
 * Carries out a plan's steps in order, and nothing the plan does not say.
 * Each placed item goes: its copy staged and measured (a copy), what it
 * replaces to the Trash, then itself into place exclusively. A step that
 * fails before anything went to the Trash takes back its own staging copy;
 * after, it leaves things as they are and says where each is. Either way the
 * rest stop. What was done is journaled for undo unless something was
 * replaced. See `plan.ts` for the invariants this keeps.
 */
export async function executePlacing(
  op: "copy" | "move",
  steps: readonly Step[],
  ops: PlacingOps,
): Promise<PlacingOutcome> {
  const moved: { from: string; identity: Identity; to: string }[] = [];
  const made: { identity: Identity; path: string }[] = [];
  const placed: Placed[] = [];
  const skipped: PlacingOutcome["skipped"] = [];
  const trashed: PlacingOutcome["trashed"] = [];
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
    let isReplaced = false;
    try {
      if (step.staging !== null) {
        ops.leftovers.add({
          identity: null,
          kind: "staging",
          path: step.staging,
        });
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
        const gone = await ops.trash(step.replaces.path);
        trashed.push({ from: step.replaces.path, ...gone });
        isReplaced = true;
      }
      await ops.place(staged ?? step.source, step.to);
      if (staged !== null) {
        ops.leftovers.remove(staged);
        staged = null;
      }
      const identity = await ops.identity(step.to);
      if (identity && step.how === "rename") {
        moved.push({ from: step.source, identity, to: step.to });
      } else if (identity) {
        made.push({ identity, path: step.to });
      }
      placed.push({
        from: step.source,
        how: step.how === "rename" ? "moved" : "copied",
        path: step.to,
        replaced: step.replaces !== null,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (isReplaced && step.replaces) {
        // What was there is in the Trash already, and stays there; the copy
        // that was to take its place is left where it was staged.
        failure = `${nameOf(step.replaces.path)} is in the Trash, but ${nameOf(step.source)} couldn’t be put in its place${staged ? `, so its copy is still at ${nameOf(staged)}` : ""}: ${why}`;
      } else {
        failure = why;
        // Its staging copy, whole or a part a failed copy left, goes.
        const staging = step.staging;
        if (staging !== null) {
          await ops
            .removeStaging(staging)
            .then(() => {
              ops.leftovers.remove(staging);
            })
            .catch(() => undefined);
        }
      }
      break;
    }
  }

  const anything = moved.length + made.length > 0;
  return {
    failure,
    journal:
      !anything || trashed.length > 0
        ? null
        : op === "copy"
          ? { kind: "copy", made }
          : { kind: "move", made, moved },
    placed,
    skipped,
    trashed,
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
  leftovers,
  trash,
}: {
  leftovers: PlacingOps["leftovers"];
  trash: PlacingOps["trash"];
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
    leftovers,
    trash,
  };
}
