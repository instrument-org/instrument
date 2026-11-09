import fs from "node:fs/promises";
import path from "node:path";

import { entryExists, moveEntrySync } from "./move-entry";

/**
 * Brings a folder an earlier build hid in the workspace's `.instrument/` out
 * to the workspace's top level, where the person reads and edits it in a
 * file manager.
 *
 * One function for all of them, because the rules are the same whatever is
 * inside and getting any of them subtly different is how a migration loses
 * something:
 *
 * - Nothing stored is rewritten. Each of these folders is found by reading
 *   it, so the one thing that says which folder is the resolver, and the
 *   move is what makes the resolver true.
 * - It never writes over anything. Where the top level already holds the
 *   folder, each hidden entry moves in under its own name only when that
 *   name is free there; one whose name is taken stays hidden, whole, and is
 *   counted. So what the person put there is never touched, and a run cut
 *   short, or one that follows a memory saved after a failed run, still
 *   brings out everything it can.
 * - A failure leaves the entry where it was. The next launch tries again.
 */

const FINDER_FILE = ".DS_Store";

/** What a move came to, for the boot log. */
export type FolderMoved =
  /** Every hidden entry's name is taken at the top level, so none moved. */
  | { kind: "already-there"; left: number; where: string }
  | { error: string; kind: "failed" }
  /** Nothing hidden, or nothing in it, which is most workspaces. */
  | { kind: "none" }
  | {
      count: number;
      kind: "moved";
      /** Entries still hidden: a name taken at the top level, or a move that failed. */
      left: number;
      where: string;
    };

export async function moveOutOfDataDir({
  from,
  rootDir,
  name,
}: {
  /** Where the build before this one kept it, inside `.instrument/`. */
  from: string;
  /** The workspace's own folder, whose top level it moves to. */
  rootDir: string;
  /** What it is called at the top level, capitalized as a person reads it. */
  name: string;
}): Promise<FolderMoved> {
  const to = path.join(rootDir, name);
  let held: string[];
  try {
    held = await fs.readdir(from);
  } catch {
    return { kind: "none" };
  }
  if (held.length === 0) {
    return { kind: "none" };
  }
  if (!entryExists(to)) {
    try {
      moveEntrySync(from, to);
    } catch (error) {
      return { error: String(error), kind: "failed" };
    }
    return { count: held.length, kind: "moved", left: 0, where: to };
  }

  // What the Finder left is no entry of the person's: it neither moves nor
  // keeps the hidden folder.
  const entries = held.filter((entry) => entry !== FINDER_FILE);
  let moved = 0;
  let taken = 0;
  let failure: string | undefined;
  for (const entry of entries) {
    const target = path.join(to, entry);
    if (entryExists(target)) {
      taken += 1;
      continue;
    }
    try {
      moveEntrySync(path.join(from, entry), target);
      moved += 1;
    } catch (error) {
      failure ??= String(error);
    }
  }
  const left = entries.length - moved;
  if (left === 0) {
    await fs.rm(path.join(from, FINDER_FILE), { force: true });
    await fs.rmdir(from).catch(() => undefined);
  }
  if (entries.length === 0) {
    return { kind: "none" };
  }
  if (moved > 0) {
    return { count: moved, kind: "moved", left, where: to };
  }
  return failure !== undefined && taken === 0
    ? { error: failure, kind: "failed" }
    : { kind: "already-there", left, where: to };
}
