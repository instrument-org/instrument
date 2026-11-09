import fs from "node:fs/promises";

/**
 * The text of a file an earlier build wrote, for a conversion that removes
 * the file once what it held is written somewhere else. Nothing only where
 * no file is there.
 *
 * Every other failure throws: a file a cloud service keeps by name only
 * while the computer is offline, one another program holds, a disk error.
 * Read as empty, any of those would have the conversion write an empty
 * body and then delete the one that could not be read, so the conversion
 * stops instead and the next launch reads the file again.
 */
export async function readOldFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw error;
  }
}
