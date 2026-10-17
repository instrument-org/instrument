import { type IFileSystem, InMemoryFs } from "just-bash";

/**
 * The read-only base filesystem underneath the workspace mounts: the disk as
 * `disk` reads it, or where there is none an empty one that tells
 * `onMissing` of each path it was asked to read. A read `onMissing` answers
 * as refused fails with EACCES instead of ENOENT.
 *
 * Everything the agent may change lives on a mount (the chat's folder, each
 * folder it reaches, the temp folders). Writes here fail with EROFS instead
 * of landing in a writable per-call InMemoryFs that silently evaporates when
 * the bash call ends, and `onWrite` hears each, so a folder the person could
 * allow is asked for rather than worked around.
 */
export class ReadOnlyBaseFs implements IFileSystem {
  private readonly disk: IFileSystem;
  private readonly onMissing: (path: string) => "refused" | undefined;
  private readonly onWrite: (path: string) => void;

  constructor({
    disk,
    onMissing = () => undefined,
    onWrite = () => undefined,
  }: {
    /** What reads the disk outside every mount, already held to the rules. */
    disk?: IFileSystem;
    onMissing?: (path: string) => "refused" | undefined;
    onWrite?: (path: string) => void;
  } = {}) {
    this.disk = disk ?? new InMemoryFs();
    // A disk says for itself why a read failed.
    this.onMissing = disk ? () => undefined : onMissing;
    this.onWrite = onWrite;
    const listing = this.disk.readdirWithFileTypes?.bind(this.disk);
    this.readdirWithFileTypes = listing
      ? (path) => this.missing(path, () => listing(path))
      : undefined;
  }

  private refuseWrite(op: string, path: string): Promise<never> {
    this.onWrite(path);
    return Promise.reject(erofs(op, path));
  }

  private missing<T>(path: string, read: () => Promise<T>): Promise<T> {
    return read().catch((error: unknown) => {
      if (this.onMissing(path) === "refused") {
        throw Object.assign(
          new Error(`EACCES: permission denied, open '${path}'`),
          { code: "EACCES" },
        );
      }
      throw error;
    });
  }

  appendFile: IFileSystem["appendFile"] = (path) =>
    this.refuseWrite("appendFile", path);
  chmod: IFileSystem["chmod"] = (path) => this.refuseWrite("chmod", path);
  cp: IFileSystem["cp"] = (_src, dest) => this.refuseWrite("cp", dest);
  exists: IFileSystem["exists"] = (path) => this.disk.exists(path);
  getAllPaths: IFileSystem["getAllPaths"] = () => this.disk.getAllPaths();
  link: IFileSystem["link"] = (_existingPath, newPath) =>
    this.refuseWrite("link", newPath);
  lstat: IFileSystem["lstat"] = (path) =>
    this.missing(path, () => this.disk.lstat(path));
  mkdir: IFileSystem["mkdir"] = (path) => this.refuseWrite("mkdir", path);
  mv: IFileSystem["mv"] = (_src, dest) => this.refuseWrite("mv", dest);
  readdir: IFileSystem["readdir"] = (path) =>
    this.missing(path, () => this.disk.readdir(path));
  /**
   * Carried through where the disk has it, so a walk of the disk reads each
   * folder once instead of stating every entry in it. Left unimplemented
   * where the disk has none, which is what tells a caller to ask about each
   * entry itself: answering with no types would read every folder as a file
   * and stop a walk at the first one.
   */
  readdirWithFileTypes: IFileSystem["readdirWithFileTypes"];
  readFile: IFileSystem["readFile"] = (path, options) =>
    this.missing(path, () => this.disk.readFile(path, options));
  readFileBuffer: IFileSystem["readFileBuffer"] = (path) =>
    this.missing(path, () => this.disk.readFileBuffer(path));
  readlink: IFileSystem["readlink"] = (path) =>
    this.missing(path, () => this.disk.readlink(path));
  realpath: IFileSystem["realpath"] = (path) =>
    this.missing(path, () => this.disk.realpath(path));
  resolvePath: IFileSystem["resolvePath"] = (base, path) =>
    this.disk.resolvePath(base, path);
  rm: IFileSystem["rm"] = (path) => this.refuseWrite("rm", path);
  stat: IFileSystem["stat"] = (path) =>
    this.missing(path, () => this.disk.stat(path));
  symlink: IFileSystem["symlink"] = (_target, linkPath) =>
    this.refuseWrite("symlink", linkPath);
  utimes: IFileSystem["utimes"] = (path) => this.refuseWrite("utimes", path);
  writeFile: IFileSystem["writeFile"] = (path) =>
    this.refuseWrite("writeFile", path);
}

// What the rules make of the write goes beside the command's output, from
// `onWrite`.
function erofs(op: string, path: string) {
  return new Error(`EROFS: read-only file system, ${op} '${path}'`);
}
