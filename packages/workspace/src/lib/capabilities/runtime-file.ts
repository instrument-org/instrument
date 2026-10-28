import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Writes a file the app loads into the programs a chat runs, whenever what
 * is there differs, so a build's copy replaces an older one and a deleted
 * file comes back. Renamed into place, so a program starting at the same
 * moment reads the old file or the new one, never half of one.
 */
export async function writeRuntimeFile(
  file: string,
  content: string,
  mode?: number,
): Promise<void> {
  const current = await fs.readFile(file, "utf8").catch(() => undefined);
  if (current === content) {
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await replaceFile(file, content, mode);
}

/**
 * Writes a file into a folder the agent can change, such as a chat's
 * virtualenv, whenever what is there differs: made new beside it and
 * renamed over it, which replaces a link at the name rather than writing
 * through it to the file the link names.
 */
export async function replaceFileIn(
  file: string,
  content: string,
): Promise<void> {
  const current = await fs.readFile(file, "utf8").catch(() => undefined);
  if (current !== content) {
    await replaceFile(file, content);
  }
}

async function replaceFile(
  file: string,
  content: string,
  mode?: number,
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, {
    flag: "wx",
    ...(mode === undefined ? {} : { mode }),
  });
  await fs.rename(temporary, file).catch(async (error: unknown) => {
    await fs.rm(temporary, { force: true });
    throw error;
  });
}
