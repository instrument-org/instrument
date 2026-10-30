import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

/**
 * Opens a file the app reads or writes as itself in a folder the agent's
 * programs can change: the chat's work folder (a background command's log)
 * or the workspace's apps folder (an app's own file and its icon).
 *
 * The app runs outside every sandbox, and a program the agent starts can
 * put a symlink at any name in those folders, the folder's own name
 * included, so an open that follows one reads or writes wherever it leads:
 * the workspace's keys, `permissions.json`, another chat's records. Here
 * nothing from `folder` itself down to the file may be a link: each folder
 * on the way is looked at without following it, made where `make` asks and
 * it is missing, and the file is opened refusing a link (`O_NOFOLLOW`) and
 * without waiting on a pipe (`O_NONBLOCK`).
 *
 * What is left is a race: a program swapping a folder on the way for a link
 * between the look and the open. Closing it would take opening each folder
 * relative to the last (`openat`), which Node does not offer. Windows has
 * neither flag; there a link is still refused on the way to the file.
 */
export function openOwnFile({
  file,
  flags,
  folder,
  make = false,
}: {
  file: string;
  flags: number;
  /** The folder the agent can change, whose parent it cannot. */
  folder: string;
  make?: boolean;
}): number {
  ownFolder({ dir: path.dirname(file), folder, make });
  return openSync(
    file,
    flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    0o666,
  );
}

/**
 * Checks that nothing from `folder` itself down to `dir` is a link, making
 * the folders that are missing where `make` asks, so a path in `dir` is
 * where its spelling says. See {@link openOwnFile}.
 */
export function ownFolder({
  dir,
  folder,
  make = false,
}: {
  dir: string;
  folder: string;
  make?: boolean;
}): void {
  const within = path.relative(path.dirname(folder), dir);
  if (within === "" || within.startsWith("..") || path.isAbsolute(within)) {
    throw new Error(`${dir} is not in ${folder}`);
  }
  let current = path.dirname(folder);
  if (make) {
    // The app's own, which no program the agent runs can change.
    mkdirSync(current, { recursive: true });
  }
  for (const segment of within.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (!make || !isCode(error, "ENOENT")) {
        throw error;
      }
      mkdirSync(current);
      continue;
    }
    if (!stat.isDirectory()) {
      const link = stat.isSymbolicLink();
      throw Object.assign(
        new Error(
          link
            ? `ELOOP: ${current} is a symbolic link`
            : `ENOTDIR: ${current} is not a folder`,
        ),
        { code: link ? "ELOOP" : "ENOTDIR" },
      );
    }
  }
}

/**
 * A file opened to read as {@link openOwnFile} opens it, through
 * `fs.promises` so a file a sync service keeps by name only downloads off
 * the main thread. Refuses one that is not a file.
 */
export async function openOwnFileToRead({
  file,
  folder,
}: {
  file: string;
  folder: string;
}): Promise<fsPromises.FileHandle> {
  ownFolder({ dir: path.dirname(file), folder });
  const handle = await fsPromises.open(
    file,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw Object.assign(new Error(`EISDIR: ${file} is not a file`), {
      code: "EISDIR",
    });
  }
  return handle;
}

/**
 * Writes a file whole, as {@link openOwnFile} opens it, making its folders:
 * to a temp name beside it no sync engine carries, synced to disk, then
 * renamed over it, so a reader sees one version or the one before it and a
 * crash mid-write leaves the older file. A link planted at the file's name
 * is replaced by the rename rather than followed.
 */
export function writeOwnFile({
  data,
  file,
  folder,
}: {
  data: string | Uint8Array;
  file: string;
  folder: string;
}): void {
  const temporary = path.join(
    path.dirname(file),
    `.~${path.basename(file)}.${process.pid.toString()}.tmp`,
  );
  try {
    // One a crash left under this process id.
    rmSync(temporary, { force: true });
    const fd = openOwnFile({
      file: temporary,
      flags:
        constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_TRUNC,
      folder,
      make: true,
    });
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
