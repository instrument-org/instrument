import fs from "node:fs/promises";
import path from "node:path";

import { MEMORY_FOLDER_NAME } from "../../constants";
import { workspaceLayout } from "../workspace-layout";

/**
 * Brings the memories an earlier build hid in the workspace's `.instrument/`
 * out to `Memory/` at its top level, where the person reads and edits them in
 * a file manager.
 *
 * Nothing stored has to be rewritten for this: a memory is found by reading
 * the folder, and `memoryDir` is the one thing that says which folder.
 *
 * Idempotent, and it never merges: a workspace whose top level already holds
 * `Memory/` is left as it is, so a second run cannot write over a file the
 * person put there themselves. The hidden folder stays where it is when the
 * move fails, and the next launch tries it again.
 */

/** What the move came to, for the boot log. */
export type MemoriesMoved =
  /** `Memory/` is already there, so the hidden folder is left alone. */
  | { kind: "already-there"; where: string }
  | { error: string; kind: "failed" }
  /** No hidden folder, or nothing in it, which is most workspaces. */
  | { kind: "none" }
  | { count: number; kind: "moved"; where: string };

export async function moveMemoriesToFolder(
  rootDir: string,
): Promise<MemoriesMoved> {
  const from = workspaceLayout(rootDir).memoryDir;
  const to = path.join(rootDir, MEMORY_FOLDER_NAME);
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
