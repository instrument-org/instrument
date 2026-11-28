import fs from "node:fs";
import path from "node:path";

/**
 * A new name for a file going into a folder, beside the ones already there:
 * the name itself when it is free, otherwise numbered the way Finder numbers
 * a copy (`image 2.png`). A name in `taken` counts as there.
 */
export function freeNameIn(
  dir: string,
  name: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const isFree = (candidate: string) =>
    !taken.has(candidate) && !fs.existsSync(path.join(dir, candidate));
  if (isFree(name)) {
    return name;
  }
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n.toString()}${extension}`;
    if (isFree(candidate)) {
      return candidate;
    }
  }
}
