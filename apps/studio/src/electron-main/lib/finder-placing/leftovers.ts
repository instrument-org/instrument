import { type Identity, UNDONE_PREFIX } from "../file-journal";
import fs from "node:fs/promises";
import path from "node:path";

import { STAGING_PREFIX } from "./plan";

/**
 * Something placing or its undo put on disk under a name of its own that
 * must not outlive it: a staging copy being written, and a copy an undo set
 * aside on its way to the Trash. Each is recorded before it exists and let
 * go of once it has gone where it belongs, so a crash or a quit in between
 * leaves a record of every one for the next launch to finish.
 */
export type Leftover = {
  /** What it was when recorded; null for a staging copy not yet written. */
  identity: Identity | null;
  kind: "staging" | "undone";
  path: string;
};

/** Where the records are kept: the machine's state in the app, memory in a test. */
export type LeftoverStore = {
  read: () => readonly Leftover[];
  write: (leftovers: readonly Leftover[]) => void;
};

export function createLeftovers(store: LeftoverStore) {
  return {
    add: (leftover: Leftover) => {
      store.write([
        ...store.read().filter((each) => each.path !== leftover.path),
        leftover,
      ]);
    },
    all: () => store.read(),
    remove: (at: string) => {
      store.write(store.read().filter((each) => each.path !== at));
    },
  };
}

export type Leftovers = ReturnType<typeof createLeftovers>;

const PREFIXES = {
  staging: STAGING_PREFIX,
  undone: UNDONE_PREFIX,
} as const;

/**
 * Finishes what a quit or a crash left: a copy an undo set aside goes to the
 * Trash, where the undo was sending it; a staging copy, a copy of something
 * still at its own place, is removed. Only a thing under its own prefix, and
 * for an undone copy still the same thing that was recorded, is touched, and
 * one that cannot be is kept for the next launch. Run once at launch, before
 * anything is placed.
 */
export async function finishLeftovers(
  leftovers: Leftovers,
  {
    identity,
    trash,
  }: {
    identity: (at: string) => Promise<Identity | null>;
    trash: (at: string) => Promise<unknown>;
  },
) {
  for (const leftover of leftovers.all()) {
    if (!path.basename(leftover.path).startsWith(PREFIXES[leftover.kind])) {
      leftovers.remove(leftover.path);
      continue;
    }
    const now = await identity(leftover.path);
    if (now === null) {
      leftovers.remove(leftover.path);
      continue;
    }
    try {
      if (leftover.kind === "staging") {
        await fs.rm(leftover.path, { force: true, recursive: true });
      } else if (
        leftover.identity &&
        leftover.identity.dev === now.dev &&
        leftover.identity.ino === now.ino
      ) {
        await trash(leftover.path);
      }
      leftovers.remove(leftover.path);
    } catch {
      // Kept, and tried again next launch.
    }
  }
}
