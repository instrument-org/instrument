import {
  ReadWriteFs,
  type ReadWriteFsOptions,
  type RmOptions,
} from "just-bash";
import { rmdir } from "node:fs/promises";
import nodePath from "node:path";

import { normalizePath } from "./normalize-path";

const RMDIR_ERRORS: Record<string, string> = {
  EACCES: "permission denied",
  EBUSY: "resource busy or locked",
  ENOENT: "no such file or directory",
  ENOTDIR: "not a directory",
  ENOTEMPTY: "directory not empty",
  EPERM: "operation not permitted",
};

/**
 * just-bash's disk-backed filesystem, able to remove an empty directory.
 *
 * `rmdir` and `find -delete` remove a directory with `rm` and no `recursive`,
 * which `ReadWriteFs` hands to Node's `fs.promises.rm`, and Node refuses every
 * directory there with EISDIR, empty or not. So both failed on every writable
 * mount with `ERR_FS_EISDIR`. This removes the directory with `rmdir(2)`
 * instead, which refuses one that is not empty on its own, so nothing that
 * appears in it between a caller's emptiness check and the removal is lost.
 *
 * Only that one case changes: `rm` without `-r` checks for a directory itself
 * and never reaches here with one, and a file, a symlink, and every recursive
 * removal still go through `ReadWriteFs`. The mount root answers EBUSY, as
 * removing a mount point does.
 */
export class ReadWriteFsWithRmdir extends ReadWriteFs {
  private readonly hostRoot: string;

  constructor(options: ReadWriteFsOptions) {
    super(options);
    this.hostRoot = options.root;
  }

  override async rm(path: string, options?: RmOptions): Promise<void> {
    if (options?.recursive || !(await this.isDirectory(path))) {
      return super.rm(path, options);
    }
    const normalized = normalizePath(path);
    if (normalized === "/") {
      throw rmdirError("EBUSY", path);
    }
    // The parent goes through `realpath`, which refuses one that resolves
    // outside the root, and the last component is taken as written, so a
    // symlink in its place is never followed to the directory it names.
    const parent = await this.realpath(nodePath.posix.dirname(normalized));
    try {
      await rmdir(
        nodePath.join(
          this.hostRoot,
          parent,
          nodePath.posix.basename(normalized),
        ),
      );
    } catch (error) {
      const code =
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "EIO";
      throw rmdirError(code === "EEXIST" ? "ENOTEMPTY" : code, path);
    }
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await this.lstat(path)).isDirectory;
    } catch {
      // Let `ReadWriteFs.rm` report the path the way it reports any other.
      return false;
    }
  }
}

/** An error naming the virtual path, never the host path behind it. */
function rmdirError(code: string, path: string) {
  const description = RMDIR_ERRORS[code] ?? "i/o error";
  return Object.assign(new Error(`${code}: ${description}, rm '${path}'`), {
    code,
  });
}
