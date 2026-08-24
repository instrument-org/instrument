import nodeIgnore from "ignore";
import fs from "node:fs/promises";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";

export async function getIgnore(
  rootDir: AbsolutePath,
  options?: { includeGit?: boolean; signal?: AbortSignal },
) {
  const gitignoreContent = await readGitignore(
    absolutePathJoin(rootDir, ".gitignore"),
    options?.signal,
  );

  const ignore = nodeIgnore().add(gitignoreContent ?? "");
  return options?.includeGit ? ignore : ignore.add(".git");
}

/**
 * The root's .gitignore, or undefined where there is nothing to read.
 *
 * Read rather than asked about: the trees this runs over are live, so a
 * .gitignore that exists when we look can be gone by the time we open it (a
 * checkout rewriting it under us), and the answer to both is the same one.
 * Anything else -- an unreadable file, an aborted read -- is a real failure and
 * still throws.
 */
async function readGitignore(
  gitignorePath: AbsolutePath,
  signal?: AbortSignal,
) {
  try {
    return await fs.readFile(gitignorePath, { encoding: "utf8", signal });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    // ENOENT: no such file. EISDIR/ENOTDIR: a directory by that name, or a
    // parent that is not one -- neither is a gitignore file either.
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") {
      return;
    }
    throw error;
  }
}
