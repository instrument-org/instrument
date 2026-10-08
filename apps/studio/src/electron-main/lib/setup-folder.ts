import fs from "node:fs/promises";
import path from "node:path";

/** What the output folder is called wherever it lives. */
export const OUTPUT_FOLDER_NAME = "Instrument";

/**
 * The folder a pick in the folder picker stands for. People pick where the
 * Instrument folder goes, so a pick is its parent; a pick of a folder already
 * called Instrument is that folder, so nobody ends up with one inside another.
 */
export function outputFolderForPick(picked: string): string {
  return path.basename(picked) === OUTPUT_FOLDER_NAME
    ? picked
    : path.join(picked, OUTPUT_FOLDER_NAME);
}

/** A path as a person reads it, with their home folder written `~`. */
export function homeRelativePath(folderPath: string, home: string): string {
  if (folderPath === home) {
    return "~";
  }
  const relative = path.relative(home, folderPath);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? folderPath
    : `~${path.sep}${relative}`;
}

/** Names a folder listing has that a person never sees in the Finder. */
function isHiddenEntry(name: string): boolean {
  return name.startsWith(".") || name === "Icon\r" || name === "desktop.ini";
}

export type SetupFolderOutcome =
  /** The folder is there, made now or kept as it was. */
  | { kind: "made" }
  /** A folder with things in it is already there, and nobody said to keep it. */
  | { items: number; kind: "exists" }
  /** The system refused to let the app into the folder's parent. */
  | { kind: "denied" };

/**
 * Makes the output folder at `folderPath`, or keeps the one already there.
 * A folder with things in it is reported first, unless `keepExisting`, so the
 * person hears about it before the app starts saving into it. Touching the
 * folder is what makes macOS ask for Documents access, and a refusal comes
 * back as `denied` rather than an error.
 */
export async function makeOutputFolder({
  folderPath,
  keepExisting,
}: {
  folderPath: string;
  keepExisting: boolean;
}): Promise<SetupFolderOutcome> {
  try {
    const items = (await fs.readdir(folderPath)).filter(
      (name) => !isHiddenEntry(name),
    ).length;
    if (items > 0 && !keepExisting) {
      return { items, kind: "exists" };
    }
    return { kind: "made" };
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM" || code === "EACCES") {
      return { kind: "denied" };
    }
    if (code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM" || code === "EACCES") {
      return { kind: "denied" };
    }
    throw error;
  }
  return { kind: "made" };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
