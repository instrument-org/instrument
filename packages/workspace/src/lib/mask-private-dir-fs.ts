import { type IFileSystem } from "just-bash";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { normalizePath } from "./normalize-path";

/**
 * True when a task-relative path (as returned by relativeWithin, e.g.
 * `/.instrument` or `/.instrument/state.json`) is the private dir or inside it.
 */
export function isPrivateRelative(relativeWithinTask: string): boolean {
  const privateSegment = `/${TASK_FOLDER_NAMES.private}`;
  return (
    relativeWithinTask === privateSegment ||
    relativeWithinTask.startsWith(`${privateSegment}/`)
  );
}

/**
 * Wrap a filesystem so the `.instrument` dir at its root is invisible to the
 * agent shell. Used for the task mount, whose private dir holds the task db and
 * state, and for the project mount, whose private dir holds the project's folder
 * list and the access granted to each.
 *
 * The mask is a decorator on the mount rather than an empty filesystem mounted
 * over `/task/.instrument`, because `MountableFs` refuses to mount inside an
 * existing mount, and the mount has to stay mounted at its root.
 *
 * Filtering by path spelling is only safe because of where this sits: every
 * path arrives already resolved (`MountableFs` normalizes before routing, and
 * strips the mount prefix), so `..` traversal, a `cd` into a subdirectory, and
 * any other constructed spelling all collapse to the same string before the
 * check. The one way to name the directory without naming it is a symlink, so
 * links that resolve into it are refused as well.
 *
 * Reads answer not-found and writes fail EROFS, matching how a path outside
 * every mount behaves. App code reaches these files through real `node:fs`, so
 * the mask is agent-only.
 *
 * This is friction, not a boundary: it covers what routes through the virtual
 * filesystem, and a native interpreter runs as a real subprocess whose cwd is
 * the real task dir, so a script opening `.instrument/state.json` at runtime
 * still reads it. See
 * docs/findings/private-dir-masking-is-not-a-boundary.md.
 */
export function maskPrivateDirFs(delegate: IFileSystem): IFileSystem {
  const readFileBytes = delegate.readFileBytes?.bind(delegate);
  const readdirWithFileTypes = delegate.readdirWithFileTypes?.bind(delegate);

  const masked: IFileSystem = {
    appendFile: (filePath, content, options) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("appendFile", filePath))
        : delegate.appendFile(filePath, content, options),

    chmod: (filePath, mode) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("chmod", filePath))
        : delegate.chmod(filePath, mode),

    cp: (src, dest, options) => {
      if (isPrivate(src)) {
        return Promise.reject(enoent("cp", src));
      }
      return isPrivate(dest)
        ? Promise.reject(erofs("cp", dest))
        : delegate.cp(src, dest, options);
    },

    exists: (filePath) =>
      isPrivate(filePath) ? Promise.resolve(false) : delegate.exists(filePath),

    getAllPaths: () =>
      delegate.getAllPaths().filter((entry) => !isPrivate(entry)),

    link: (existingPath, newPath) => {
      if (isPrivate(existingPath)) {
        return Promise.reject(enoent("link", existingPath));
      }
      return isPrivate(newPath)
        ? Promise.reject(erofs("link", newPath))
        : delegate.link(existingPath, newPath);
    },

    lstat: (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("lstat", filePath))
        : delegate.lstat(filePath),

    mkdir: (filePath, options) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("mkdir", filePath))
        : delegate.mkdir(filePath, options),

    mv: (src, dest) => {
      if (isPrivate(src)) {
        return Promise.reject(enoent("mv", src));
      }
      return isPrivate(dest)
        ? Promise.reject(erofs("mv", dest))
        : delegate.mv(src, dest);
    },

    readdir: async (filePath) => {
      if (isPrivate(filePath)) {
        throw enoent("scandir", filePath);
      }
      return withoutPrivateEntry(filePath, await delegate.readdir(filePath));
    },

    readFile: (filePath, options) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("open", filePath))
        : delegate.readFile(filePath, options),

    readFileBuffer: (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("open", filePath))
        : delegate.readFileBuffer(filePath),

    readlink: (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("readlink", filePath))
        : delegate.readlink(filePath),

    realpath: (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("realpath", filePath))
        : delegate.realpath(filePath),

    resolvePath: (base, filePath) => delegate.resolvePath(base, filePath),

    rm: (filePath, options) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("rm", filePath))
        : delegate.rm(filePath, options),

    stat: (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("stat", filePath))
        : delegate.stat(filePath),

    symlink: (target, linkPath) =>
      isPrivate(linkPath) || symlinkResolvesIntoPrivate(target, linkPath)
        ? Promise.reject(erofs("symlink", linkPath))
        : delegate.symlink(target, linkPath),

    utimes: (filePath, atime, mtime) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("utimes", filePath))
        : delegate.utimes(filePath, atime, mtime),

    writeFile: (filePath, content, options) =>
      isPrivate(filePath)
        ? Promise.reject(erofs("writeFile", filePath))
        : delegate.writeFile(filePath, content, options),
  };

  // Forwarded only when the delegate has them: callers fall back to the
  // required methods otherwise, and an unconditional stub would strand that
  // fallback on a filesystem that cannot answer.
  if (readFileBytes) {
    masked.readFileBytes = (filePath) =>
      isPrivate(filePath)
        ? Promise.reject(enoent("open", filePath))
        : readFileBytes(filePath);
  }

  if (readdirWithFileTypes) {
    masked.readdirWithFileTypes = async (filePath) => {
      if (isPrivate(filePath)) {
        throw enoent("scandir", filePath);
      }
      const entries = await readdirWithFileTypes(filePath);
      return withinTaskRoot(filePath)
        ? entries.filter((entry) => entry.name !== TASK_FOLDER_NAMES.private)
        : entries;
    };
  }

  return masked;
}

function enoent(op: string, filePath: string) {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, ${op} '${filePath}'`),
    { code: "ENOENT" },
  );
}

function erofs(op: string, filePath: string) {
  return Object.assign(
    new Error(
      `EROFS: read-only file system, ${op} '${filePath}' -- the ` +
        `${TASK_FOLDER_NAMES.private} directory holds internals and is ` +
        `not writable`,
    ),
    { code: "EROFS" },
  );
}

/**
 * True for the private dir or anything inside it. Paths here are relative to
 * the task mount, so a leading `/` means the task root.
 */
function isPrivate(mountRelativePath: string): boolean {
  const normalized = normalizePath(mountRelativePath);
  return isPrivateRelative(
    normalized.startsWith("/") ? normalized : `/${normalized}`,
  );
}

/**
 * A symlink is the one way to reach the private dir without spelling it in the
 * path passed to a later call, so resolve the target the way both a relative
 * and an absolute reading would land and refuse either.
 */
function symlinkResolvesIntoPrivate(target: string, linkPath: string): boolean {
  const normalizedLink = normalizePath(linkPath);
  const linkDir = path.posix.dirname(
    normalizedLink.startsWith("/") ? normalizedLink : `/${normalizedLink}`,
  );
  return (
    isPrivate(target) ||
    isPrivate(path.posix.resolve(linkDir, normalizePath(target)))
  );
}

function withinTaskRoot(mountRelativePath: string): boolean {
  const normalized = normalizePath(mountRelativePath);
  return normalized === "/" || normalized === "." || normalized === "";
}

function withoutPrivateEntry(mountRelativePath: string, entries: string[]) {
  return withinTaskRoot(mountRelativePath)
    ? entries.filter((entry) => entry !== TASK_FOLDER_NAMES.private)
    : entries;
}
