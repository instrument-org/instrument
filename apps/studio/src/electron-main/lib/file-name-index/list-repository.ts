import { RG_DISK_PATH } from "@instrument-org/workspace/electron";
import { execFile } from "node:child_process";

/**
 * The most ripgrep's list of one repository may come to. A repository past
 * it, a few hundred thousand files, is walked folder by folder, where the
 * caps stop the walk early.
 */
const LIST_BYTES_MAX = 32 * 1024 * 1024;

/**
 * The files of the repository at `folder` as the bundled ripgrep lists
 * them, each a path from `folder` with `/` between the names: what the
 * repository's `.gitignore` and `.ignore` files leave in, no hidden file, no
 * link followed, nothing on another disk. Undefined when ripgrep is missing,
 * fails, lists more than `LIST_BYTES_MAX`, or is still running after
 * `timeoutMs`, when it is killed.
 *
 * It lists names and never opens a listed file. Outside `folder` it opens
 * only the ignore files of the folders above it (`.gitignore`, `.ignore`,
 * `.rgignore`), which ripgrep opens even when told not to apply them, so
 * the caller has to know those folders are safe to read in. It reads no
 * ignore file git is set up with for every repository, no ripgrep setup of
 * the person's own, and, with `--no-ignore-exclude`, nothing of the git
 * folder a worktree's or a submodule's `.git` file points to.
 */
export function listRepositoryFiles(
  folder: string,
  { rgPath = RG_DISK_PATH, timeoutMs }: { rgPath?: string; timeoutMs: number },
): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      rgPath,
      [
        "--files",
        "--null",
        "--no-config",
        "--no-ignore-exclude",
        "--no-ignore-global",
        "--no-ignore-parent",
        "--no-messages",
        "--one-file-system",
        "--path-separator=/",
      ],
      {
        cwd: folder,
        encoding: "utf8",
        killSignal: "SIGKILL",
        maxBuffer: LIST_BYTES_MAX,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout) => {
        // ripgrep exits with 1 when it lists nothing, with nothing wrong.
        const listedNothing = error?.code === 1 && stdout === "";
        resolve(
          error && !listedNothing
            ? undefined
            : stdout.split("\0").filter((file) => file !== ""),
        );
      },
    );
  });
}
