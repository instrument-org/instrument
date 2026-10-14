import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Opens a file the app reads or writes as itself in a folder the agent's
 * programs can change: the chat's work folder (a background command's log)
 * or the workspace's apps folder (an app's manifest, guide and icon).
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

/** A file's bytes, read as {@link openOwnFile} opens it. */
export function readOwnFile({
  file,
  folder,
}: {
  file: string;
  folder: string;
}): Buffer {
  const fd = openOwnFile({ file, flags: constants.O_RDONLY, folder });
  try {
    if (!fstatSync(fd).isFile()) {
      throw Object.assign(new Error(`EISDIR: ${file} is not a file`), {
        code: "EISDIR",
      });
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes a file whole, as {@link openOwnFile} opens it, making its folders. */
export function writeOwnFile({
  data,
  file,
  folder,
}: {
  data: string | Uint8Array;
  file: string;
  folder: string;
}): void {
  const fd = openOwnFile({
    file,
    flags: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    folder,
    make: true,
  });
  try {
    writeFileSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
