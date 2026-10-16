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
 * - It never merges. A top level that already holds the folder is left as
 *   it is, so a second run cannot write over what the person put there, and
 *   the hidden copy stays where it is rather than being half-emptied.
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
  const taken = await fs
    .access(to)
    .then(() => true)
    .catch(() => false);
  if (taken) {
    return { kind: "already-there", where: to };
  }
  try {
    await fs.rename(from, to);
  } catch (error) {
    return { error: String(error), kind: "failed" };
  }
  return { count: held.length, kind: "moved", where: to };
}
