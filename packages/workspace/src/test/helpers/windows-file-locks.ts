import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

// The CommonJS object behind `node:sqlite` (and `fs` above is the one behind
// `node:fs`), which `syncBuiltinESMExports` copies onto every module's named
// imports. `require` returns `any`, so it is named as the module it is.
const sqlite = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * Windows refuses to remove or rename a file SQLite has open, or any folder
 * above one, where macOS and Linux let both through, so a test that leaves a
 * database open passes where it was written and fails only on Windows CI.
 * Outside Windows this makes those calls refuse too, with the error Windows
 * gives, while a database the test or the code under it opened is still open.
 */
export function refuseOverOpenDatabasesLikeWindows() {
  if (process.platform === "win32") {
    return;
  }
  const open = new Set<import("node:sqlite").DatabaseSync>();
  const Database = sqlite.DatabaseSync;
  sqlite.DatabaseSync = class extends Database {
    constructor(...args: ConstructorParameters<typeof Database>) {
      super(...args);
      open.add(this);
    }
  };

  const real = (file: string): string => {
    try {
      return fs.realpathSync.native(file);
    } catch {
      const parent = path.dirname(file);
      return parent === file
        ? file
        : path.join(real(parent), path.basename(file));
    }
  };
  /** The open database `target` is, is beside (`-wal`, `-journal`) or is a folder above. */
  const heldBy = (target: string | URL | Buffer) => {
    if (open.size === 0) {
      return;
    }
    const at = real(path.resolve(target.toString()));
    for (const database of open) {
      if (!database.isOpen) {
        open.delete(database);
        continue;
      }
      const file = database.location();
      if (
        file !== null &&
        (file === at ||
          at.startsWith(`${file}-`) ||
          file.startsWith(at + path.sep))
      ) {
        return file;
      }
    }
    return;
  };
  const refusal = (syscall: string, target: string | URL | Buffer) => {
    const file = heldBy(target);
    return file === undefined
      ? undefined
      : Object.assign(
          new Error(
            `EPERM: operation not permitted, ${syscall} '${target.toString()}': ${file} is still open, and Windows refuses to ${syscall === "rename" ? "rename" : "remove"} an open file or a folder with one in it. Close the database first (the tests fake this outside Windows, in src/test/helpers/windows-file-locks.ts).`,
          ),
          { code: "EPERM", errno: -4048, path: target.toString(), syscall },
        );
  };
  const refusalOfRename = (
    from: string | URL | Buffer,
    to: string | URL | Buffer,
  ) => refusal("rename", from) ?? refusal("rename", to);

  for (const name of ["rmSync", "rmdirSync", "unlinkSync"] as const) {
    const original = fs[name] as (target: string, ...rest: unknown[]) => void;
    Object.assign(fs, {
      [name]: (target: string, ...rest: unknown[]) => {
        const error = refusal(syscallOf(name), target);
        if (error !== undefined) {
          throw error;
        }
        original(target, ...rest);
      },
    });
  }
  const renameSync = fs.renameSync;
  fs.renameSync = (from, to) => {
    const error = refusalOfRename(from, to);
    if (error !== undefined) {
      throw error;
    }
    renameSync(from, to);
  };

  for (const name of ["rm", "rmdir", "unlink"] as const) {
    const original = fs[name] as (target: string, ...rest: unknown[]) => void;
    Object.assign(fs, {
      [name]: (target: string, ...rest: unknown[]) => {
        const error = refusal(syscallOf(name), target);
        const callback = rest.at(-1);
        if (error !== undefined && typeof callback === "function") {
          process.nextTick(() => {
            Reflect.apply(callback, undefined, [error]);
          });
          return;
        }
        original(target, ...rest);
      },
    });
  }
  const rename = fs.rename;
  Object.assign(fs, {
    rename: (
      from: string,
      to: string,
      callback: (error: Error | null) => void,
    ) => {
      const error = refusalOfRename(from, to);
      if (error !== undefined) {
        process.nextTick(() => {
          callback(error);
        });
        return;
      }
      rename(from, to, callback);
    },
  });

  for (const name of ["rm", "rmdir", "unlink"] as const) {
    const original = fs.promises[name] as (
      target: string,
      ...rest: unknown[]
    ) => Promise<void>;
    Object.assign(fs.promises, {
      [name]: (target: string, ...rest: unknown[]) => {
        const error = refusal(syscallOf(name), target);
        return error === undefined
          ? original(target, ...rest)
          : Promise.reject(error);
      },
    });
  }
  const renamePromise = fs.promises.rename;
  fs.promises.rename = (from, to) => {
    const error = refusalOfRename(from, to);
    return error === undefined
      ? renamePromise(from, to)
      : Promise.reject(error);
  };

  syncBuiltinESMExports();
}

const syscallOf = (name: string) => name.replace(/Sync$/, "");
