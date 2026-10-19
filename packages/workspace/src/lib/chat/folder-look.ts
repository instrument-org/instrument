import fs from "node:fs/promises";

import { readRefusalOf } from "../read-refusal";

/**
 * A look inside a folder that waits as long as the system's own ask is up:
 * "open", "missing", or who refused it.
 */
export async function listFolder(
  folderPath: string,
): Promise<"account" | "missing" | "open" | "system"> {
  try {
    const dir = await fs.opendir(folderPath);
    try {
      await dir.read();
    } finally {
      await dir.close();
    }
    return "open";
  } catch (error) {
    return readRefusalOf(error) ?? "missing";
  }
}
