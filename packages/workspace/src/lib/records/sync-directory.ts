import fs from "node:fs/promises";

/** Errors a file system gives for a directory it cannot sync on its own. */
const UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM"]);

/**
 * Makes a folder's names durable, so a file created or renamed into it is
 * still there after a power loss. Windows cannot open a folder to sync it and
 * keeps its own names in order, so there it does nothing, as it does on a
 * file system that refuses.
 */
export async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const handle = await fs.open(dir, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && isUnsupported(error))) {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

function isUnsupported(error: Error & { code: unknown }): boolean {
  return typeof error.code === "string" && UNSUPPORTED.has(error.code);
}
