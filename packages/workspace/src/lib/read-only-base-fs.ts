import { type IFileSystem, InMemoryFs } from "just-bash";

/**
 * The empty, read-only base filesystem underneath the workspace mounts, which
 * tells `onMissing` of each path it was asked to read. A read `onMissing`
 * answers as refused fails with EACCES instead of ENOENT.
 *
 * Everything the agent may change lives on a mount (the chat's folder and
 * each folder it reaches). Writes here fail with EROFS instead of landing in a
 * writable per-call InMemoryFs that silently evaporates when the bash call
 * ends, and `onWrite` hears each, so a folder the person could allow is asked
 * for rather than worked around.
 */
export class ReadOnlyBaseFs implements IFileSystem {
  private readonly empty = new InMemoryFs();

  constructor(
    private readonly onMissing: (path: string) => "refused" | undefined = () =>
      undefined,
    private readonly onWrite: (path: string) => void = () => undefined,
  ) {}

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
  exists: IFileSystem["exists"] = (path) => this.empty.exists(path);
  getAllPaths: IFileSystem["getAllPaths"] = () => this.empty.getAllPaths();
  link: IFileSystem["link"] = (_existingPath, newPath) =>
    this.refuseWrite("link", newPath);
  lstat: IFileSystem["lstat"] = (path) =>
    this.missing(path, () => this.empty.lstat(path));
  mkdir: IFileSystem["mkdir"] = (path) => this.refuseWrite("mkdir", path);
  mv: IFileSystem["mv"] = (_src, dest) => this.refuseWrite("mv", dest);
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
  rm: IFileSystem["rm"] = (path) => this.refuseWrite("rm", path);
  stat: IFileSystem["stat"] = (path) =>
    this.missing(path, () => this.empty.stat(path));
  symlink: IFileSystem["symlink"] = (_target, linkPath) =>
    this.refuseWrite("symlink", linkPath);
  utimes: IFileSystem["utimes"] = (path) =>
    this.refuseWrite("utimes", path);
  writeFile: IFileSystem["writeFile"] = (path) =>
    this.refuseWrite("writeFile", path);
}

function erofs(op: string, path: string) {
  return new Error(
    `EROFS: read-only file system, ${op} '${path}' -- only this ` +
      `conversation's folder and the folders you reach can be changed`,
  );
}
