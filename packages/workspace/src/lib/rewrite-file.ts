import fs from "node:fs";
import path from "node:path";

/** How many times a write is built again for a file that changed under it. */
const ATTEMPTS = 3;

/**
 * Writes a text file whole, built from what the file holds at the moment of
 * writing: `render` gets its text (nothing where there is no file) and
 * returns the text to write. A file someone else writes too (the person in
 * an editor, the agent, a sync engine) keeps what they wrote meanwhile, so
 * an update to its front matter never takes a body edited since it was read.
 *
 * The bytes go to a temp name no sync engine carries, synced to disk, then
 * renamed over the file, so a reader sees one version or the one before it
 * and a crash mid-write leaves the older file. Where the file changed
 * between the read and the rename, the write is built again from the newer
 * text, a few times before the last build is written regardless.
 */
export function rewriteFileSync(
  file: string,
  render: (current: string | undefined) => string,
): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(
    dir,
    `.~${path.basename(file)}.${process.pid.toString()}.tmp`,
  );
  for (let attempt = 1; ; attempt++) {
    const current = readIfThere(file);
    try {
      // Created new (`wx`), so a link left at the temp name is never written
      // through.
      fs.rmSync(temporary, { force: true });
      fs.writeFileSync(temporary, render(current), {
        encoding: "utf8",
        flag: "wx",
        flush: true,
      });
      if (attempt < ATTEMPTS && readIfThere(file) !== current) {
        fs.rmSync(temporary, { force: true });
        continue;
      }
      fs.renameSync(temporary, file);
      return;
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
}

function readIfThere(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
