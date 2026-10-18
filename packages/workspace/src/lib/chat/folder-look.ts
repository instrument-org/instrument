import fs from "node:fs/promises";

import { readRefusalOf } from "../read-refusal";

/**
 * How long a look inside a folder may take before it counts as waiting on the
 * system's ask. A folder the app may read answers well inside this.
 */
const LOOK_INSIDE_MS = 750;

/**
 * A look inside a folder, which is what the operating system gates. On a Mac
 * the first look into Desktop, Documents, Downloads or a removable volume
 * raises the system's own ask, and taking it as the person allows the folder
 * puts that ask beside the card that caused it rather than at the agent's
 * first `ls` in it.
 *
 * "asking" when the system is still waiting on the person, which can be
 * never; "system" when the system refused, which only its own folder panel
 * undoes; "account" when this account cannot read the folder at all.
 */
export async function lookInside(
  folderPath: string,
): Promise<"account" | "asking" | "missing" | "open" | "system"> {
  const look = listFolder(folderPath);
  let timer: NodeJS.Timeout | undefined;
  const asking = new Promise<"asking">((resolve) => {
    timer = setTimeout(() => {
      resolve("asking");
    }, LOOK_INSIDE_MS);
  });
  try {
    return await Promise.race([look, asking]);
  } finally {
    clearTimeout(timer);
  }
}

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
