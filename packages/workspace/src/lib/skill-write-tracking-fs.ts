import { type IFileSystem } from "just-bash";

import { recordWorkspaceSkillMutation } from "./workspace-skill-index";

/**
 * Records successful mutations to a mounted skills filesystem without changing
 * its read or write behavior.
 */
export function skillWriteTrackingFs(
  delegate: IFileSystem,
  /**
   * A path as the delegate is given it, as a path inside the skills folder,
   * or undefined for a path outside it. The delegate is the skills folder
   * itself unless it is a wider folder holding it.
   */
  toSkillPath: (path: string) => string | undefined = (path) => path,
): IFileSystem {
  const record = (paths: string[]) => {
    for (const path of paths) {
      const inSkills = toSkillPath(path);
      if (inSkills !== undefined) {
        recordWorkspaceSkillMutation(inSkills);
      }
    }
  };
  const recordAfter = async <T>(
    operation: Promise<T>,
    paths: string[],
  ): Promise<T> => {
    const result = await operation;
    record(paths);
    return result;
  };
  const readFileBytes = delegate.readFileBytes?.bind(delegate);
  const readdirWithFileTypes = delegate.readdirWithFileTypes?.bind(delegate);
  const createExclusive = delegate.createExclusive?.bind(delegate);
  const tracked: IFileSystem = {
    appendFile: (...args) =>
      recordAfter(delegate.appendFile(...args), [args[0]]),
    chmod: (...args) => recordAfter(delegate.chmod(...args), [args[0]]),
    cp: (...args) => recordAfter(delegate.cp(...args), [args[1]]),
    exists: (...args) => delegate.exists(...args),
    getAllPaths: () => delegate.getAllPaths(),
    link: (...args) => recordAfter(delegate.link(...args), [args[1]]),
    lstat: (...args) => delegate.lstat(...args),
    mkdir: async (...args) => {
      const existed = await delegate.exists(args[0]);
      await delegate.mkdir(...args);
      if (!existed) {
        record([args[0]]);
      }
    },
    mv: (...args) => recordAfter(delegate.mv(...args), [args[0], args[1]]),
    readdir: (...args) => delegate.readdir(...args),
    readFile: (...args) => delegate.readFile(...args),
    readFileBuffer: (...args) => delegate.readFileBuffer(...args),
    readlink: (...args) => delegate.readlink(...args),
    realpath: (...args) => delegate.realpath(...args),
    resolvePath: (...args) => delegate.resolvePath(...args),
    rm: (...args) => recordAfter(delegate.rm(...args), [args[0]]),
    stat: (...args) => delegate.stat(...args),
    symlink: (...args) => recordAfter(delegate.symlink(...args), [args[1]]),
    utimes: (...args) => recordAfter(delegate.utimes(...args), [args[0]]),
    writeFile: (...args) => recordAfter(delegate.writeFile(...args), [args[0]]),
  };

  if (readFileBytes) {
    tracked.readFileBytes = readFileBytes;
  }
  if (readdirWithFileTypes) {
    tracked.readdirWithFileTypes = readdirWithFileTypes;
  }
  // What `mktemp` makes its file with; without it a mount holding the
  // skills fails every `mktemp` there with ENOSYS.
  if (createExclusive) {
    tracked.createExclusive = (...args) =>
      recordAfter(createExclusive(...args), [args[0]]);
  }
  return tracked;
}
