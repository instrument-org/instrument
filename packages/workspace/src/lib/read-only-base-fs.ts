import { type IFileSystem, InMemoryFs } from "just-bash";

/**
 * The empty, read-only base filesystem underneath the workspace mounts.
 *
 * Everything the agent may touch lives on a mount (/task, /mnt/<name>); the
 * base exists only so the mount tree has a root. Reads behave like an empty
 * filesystem, so `ls /` shows just the mount points. Writes fail with EROFS
 * instead of landing in a writable per-call InMemoryFs that silently
 * evaporates when the bash call ends -- the loud failure steers the agent to
 * put the file under the task instead of losing it.
 */
export class ReadOnlyBaseFs implements IFileSystem {
  private readonly empty = new InMemoryFs();

  appendFile: IFileSystem["appendFile"] = (path) => Promise.reject(erofs("appendFile", path));
  chmod: IFileSystem["chmod"] = (path) => Promise.reject(erofs("chmod", path));
  cp: IFileSystem["cp"] = (_src, dest) => Promise.reject(erofs("cp", dest));
  exists: IFileSystem["exists"] = (path) => this.empty.exists(path);
  getAllPaths: IFileSystem["getAllPaths"] = () => this.empty.getAllPaths();
  link: IFileSystem["link"] = (_existingPath, newPath) => Promise.reject(erofs("link", newPath));
  lstat: IFileSystem["lstat"] = (path) => this.empty.lstat(path);
  mkdir: IFileSystem["mkdir"] = (path) => Promise.reject(erofs("mkdir", path));
  mv: IFileSystem["mv"] = (_src, dest) => Promise.reject(erofs("mv", dest));
  readdir: IFileSystem["readdir"] = (path) => this.empty.readdir(path);
  readFile: IFileSystem["readFile"] = (path, options) =>
    this.empty.readFile(path, options);
  readFileBuffer: IFileSystem["readFileBuffer"] = (path) =>
    this.empty.readFileBuffer(path);
  readlink: IFileSystem["readlink"] = (path) => this.empty.readlink(path);
  realpath: IFileSystem["realpath"] = (path) => this.empty.realpath(path);
  resolvePath: IFileSystem["resolvePath"] = (base, path) =>
    this.empty.resolvePath(base, path);
  rm: IFileSystem["rm"] = (path) => Promise.reject(erofs("rm", path));
  stat: IFileSystem["stat"] = (path) => this.empty.stat(path);
  symlink: IFileSystem["symlink"] = (_target, linkPath) => Promise.reject(erofs("symlink", linkPath));
  utimes: IFileSystem["utimes"] = (path) => Promise.reject(erofs("utimes", path));
  writeFile: IFileSystem["writeFile"] = (path) => Promise.reject(erofs("writeFile", path));
}

function erofs(op: string, path: string) {
  return new Error(
    `EROFS: read-only file system, ${op} '${path}' -- only the task ` +
      `and its mounts are writable; put files under the task (cwd) instead`,
  );
}
