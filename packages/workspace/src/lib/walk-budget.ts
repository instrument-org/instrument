import { type IFileSystem } from "just-bash";

/**
 * A cap on how many directory entries one shell call may list under the
 * folders it wraps, apart from the shell's own traversal limit.
 *
 * just-bash has one traversal budget per shell, and the agent's shell
 * needs two: the sandbox's own over its working folder, where a project with its
 * `node_modules` is ordinary work, and a smaller one over the home
 * folder, where a stray `find` or `grep -r` lists millions of entries with a
 * blocking call per entry and returns nothing. So the home mount is wrapped:
 * its listings are counted, and the listing that passes the limit throws,
 * which ends a `find`, `grep -r`, `ls -R` or `tree` with this message rather
 * than letting it run on. `rg` and `du` walk the
 * directories natively, outside just-bash's filesystem, and are not counted.
 *
 * Reset at the start of every command the shell runs (`resetEachCommand`),
 * so one walk over the home folder does not spend the next command's budget.
 */
export interface WalkBudget {
  /** Counts again from zero. */
  reset: () => void;
  /** `fs` with its directory listings counted against this budget. */
  /**
   * `fs` with its directory listings counted against this budget, but for
   * listings `exempt` says are walked at the sandbox's own budget instead.
   */
  wrap: (
    fs: IFileSystem,
    root: string,
    exempt?: (path: string) => boolean,
  ) => IFileSystem;
}

export function createWalkBudget(limit: number): WalkBudget {
  let listed = 0;
  const counted = <T>(entries: T[], root: string): T[] => {
    listed += entries.length;
    if (listed > limit) {
      throw new Error(
        `stopped walking ${root} after ${limit.toLocaleString("en-US")} entries: it is too large to walk this way. Search it with \`rg --files -g '<glob>' <folder>\` or \`rg -l '<pattern>' <folder>\`, which finish in seconds, or walk one folder inside it.`,
      );
    }
    return entries;
  };
  return {
    reset: () => {
      listed = 0;
    },
    wrap: (fs, root, exempt = () => false) =>
      // A proxy rather than a copy of the methods, so every other call
      // reaches the filesystem as it is, with `this` bound to it.
      new Proxy(fs, {
        get(target, property, receiver) {
          if (property === "readdir") {
            return async (path: string) => {
              const entries = await target.readdir(path);
              return exempt(path) ? entries : counted(entries, root);
            };
          }
          if (property === "readdirWithFileTypes") {
            return target.readdirWithFileTypes
              ? async (path: string) => {
                  const entries =
                    (await target.readdirWithFileTypes?.(path)) ?? [];
                  return exempt(path) ? entries : counted(entries, root);
                }
              : undefined;
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? (...args: unknown[]): unknown =>
                Reflect.apply(value, target, args)
            : value;
        },
      }),
  };
}
