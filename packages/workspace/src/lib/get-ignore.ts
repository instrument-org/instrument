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
 * The root's .gitignore, or undefined where there is nothing this can read.
 *
 * Read rather than asked about: the trees this runs over are live, so a
 * .gitignore that exists when we look can be gone by the time we open it (a
 * checkout rewriting it under us), and the answer to both is the same one.
 * An aborted read is a real failure and still throws.
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
    // parent that is not one -- neither is a gitignore file either. EACCES and
    // EPERM: a mode the agent set on what it wrote, or one an archive restored
    // with its permissions, which is the same door the walk over the tree steps
    // around rather than stopping at. Every caller here would otherwise fail
    // whole -- a file listing, a task copy, a skill install -- over a file whose
    // only job is to make the result smaller.
    if (
      code === "ENOENT" ||
      code === "EISDIR" ||
      code === "ENOTDIR" ||
      code === "EACCES" ||
      code === "EPERM"
    ) {
      return;
    }
    throw error;
  }
}
