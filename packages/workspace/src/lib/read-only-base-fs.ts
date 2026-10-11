import { type IFileSystem, InMemoryFs } from "just-bash";

/**
 * The empty, read-only base filesystem underneath the workspace mounts, which
 * tells `onMissing` of each path it was asked to read. A read `onMissing`
 * answers as refused fails with EACCES instead of ENOENT.
 *
 * Everything the agent may change lives on a mount (the chat's folder and
 * each folder it reaches). Writes here fail with EROFS instead of landing in a
 * writable per-call InMemoryFs that silently evaporates when the bash call
 * ends -- the loud failure steers the agent to put the file in its own folder
 * instead of losing it.
 */
export class ReadOnlyBaseFs implements IFileSystem {
  private readonly empty = new InMemoryFs();

  constructor(
    private readonly onMissing: (path: string) => "refused" | undefined = () =>
      undefined,
  ) {}

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
    Promise.reject(erofs("appendFile", path));
  chmod: IFileSystem["chmod"] = (path) => Promise.reject(erofs("chmod", path));
  cp: IFileSystem["cp"] = (_src, dest) => Promise.reject(erofs("cp", dest));
  exists: IFileSystem["exists"] = (path) => this.empty.exists(path);
  getAllPaths: IFileSystem["getAllPaths"] = () => this.empty.getAllPaths();
  link: IFileSystem["link"] = (_existingPath, newPath) =>
    Promise.reject(erofs("link", newPath));
  lstat: IFileSystem["lstat"] = (path) =>
    this.missing(path, () => this.empty.lstat(path));
  mkdir: IFileSystem["mkdir"] = (path) => Promise.reject(erofs("mkdir", path));
  mv: IFileSystem["mv"] = (_src, dest) => Promise.reject(erofs("mv", dest));
  readdir: IFileSystem["readdir"] = (path) =>
    this.missing(path, () => this.empty.readdir(path));
  readFile: IFileSystem["readFile"] = (path, options) =>
    this.missing(path, () => this.empty.readFile(path, options));
  readFileBuffer: IFileSystem["readFileBuffer"] = (path) =>
    this.missing(path, () => this.empty.readFileBuffer(path));
  readlink: IFileSystem["readlink"] = (path) =>
    this.missing(path, () => this.empty.readlink(path));
  realpath: IFileSystem["realpath"] = (path) =>
    this.missing(path, () => this.empty.realpath(path));
  resolvePath: IFileSystem["resolvePath"] = (base, path) =>
    this.empty.resolvePath(base, path);
  rm: IFileSystem["rm"] = (path) => Promise.reject(erofs("rm", path));
  stat: IFileSystem["stat"] = (path) =>
    this.missing(path, () => this.empty.stat(path));
  symlink: IFileSystem["symlink"] = (_target, linkPath) =>
    Promise.reject(erofs("symlink", linkPath));
  utimes: IFileSystem["utimes"] = (path) =>
    Promise.reject(erofs("utimes", path));
  writeFile: IFileSystem["writeFile"] = (path) =>
    Promise.reject(erofs("writeFile", path));
}

function erofs(op: string, path: string) {
  return new Error(
    `EROFS: read-only file system, ${op} '${path}' -- only this ` +
      `conversation's folder and the folders you reach are writable; put ` +
      `files in this conversation's folder (the working directory) instead`,
  );
}
