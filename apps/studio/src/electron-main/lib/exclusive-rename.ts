import fs from "node:fs/promises";

import { renameExclusive as nativeRenameExclusive } from "./mac-native";

/**
 * Renames a thing to a path nothing is at, and fails with `EEXIST` rather
 * than replace what is there, which `fs.rename` does.
 *
 * On the Mac the bridge's `renamex_np` with RENAME_EXCL checks and renames
 * in one step. Elsewhere Node reaches no such rename (Linux's `renameat2`
 * with RENAME_NOREPLACE and Windows' `MoveFileExW` without
 * MOVEFILE_REPLACE_EXISTING both want a native module of our own), so the
 * name is checked just before the rename, which leaves that instant for
 * something else to take it.
 */
export async function renameExclusive(from: string, to: string) {
  if (await nativeRenameExclusive(from, to)) {
    return;
  }
  const there = await fs.lstat(to).then(
    () => true,
    (error: unknown) =>
      !(error instanceof Error && "code" in error && error.code === "ENOENT"),
  );
  if (there) {
    throw Object.assign(new Error(`Something is already at ${to}`), {
      code: "EEXIST",
    });
  }
  await fs.rename(from, to);
}
