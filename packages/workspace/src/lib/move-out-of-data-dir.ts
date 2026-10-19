import fs from "node:fs/promises";
import path from "node:path";

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
 * - It never merges into a folder with something in it. A top level that
 *   already holds the folder with the person's own work in it is left as it
 *   is, so a second run cannot write over what they put there, and the
 *   hidden copy stays where it is rather than being half-emptied.
 * - An empty folder of that name is moved into, since nothing can be written
 *   over and leaving it would hide what was hidden for good: the resolver
 *   reads the empty one and the person's work stays somewhere they cannot
 *   find. Both the app and the person make these, so it is the common case
 *   rather than a corner of one.
 * - A failure leaves everything where it was. The next launch tries again.
 */

/** What a move came to, for the boot log. */
export type FolderMoved =
  /** The folder is already at the top level, so the hidden one is left. */
  | { kind: "already-there"; where: string }
  | { error: string; kind: "failed" }
  /** Nothing hidden, or nothing in it, which is most workspaces. */
  | { kind: "none" }
  | { count: number; kind: "moved"; where: string };

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
  const there = await fs.readdir(to).catch(() => undefined);
  if (there !== undefined) {
    return there.some((entry) => entry !== ".DS_Store")
      ? { kind: "already-there", where: to }
      : moveEachInto({ from, held, to });
  }
  try {
    await fs.rename(from, to);
  } catch (error) {
    return { error: String(error), kind: "failed" };
  }
  return { count: held.length, kind: "moved", where: to };
}

/**
 * Into the empty folder already at the top level, one entry at a time, since
 * the folder itself cannot be renamed over one that is there. The hidden
 * folder goes once it holds nothing; an entry left behind keeps it, and the
 * next launch moves that one.
 */
async function moveEachInto({
  from,
  held,
  to,
}: {
  from: string;
  held: string[];
  to: string;
}): Promise<FolderMoved> {
  let moved = 0;
  for (const entry of held) {
    try {
      await fs.rename(path.join(from, entry), path.join(to, entry));
      moved += 1;
    } catch (error) {
      if (moved === 0) {
        return { error: String(error), kind: "failed" };
      }
    }
  }
  await fs.rmdir(from).catch(() => undefined);
  return { count: moved, kind: "moved", where: to };
}
