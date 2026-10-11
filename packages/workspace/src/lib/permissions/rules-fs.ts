import { type IFileSystem } from "just-bash";
import nodePath from "node:path";

import { raiseAsk, waitingNote } from "./asks";
import { folderToAskFor, reachOf, type Rules } from "./rules";

/**
 * What the agent reads when the rules keep it from a path, spelled the way it
 * reaches things: `spell` turns a host path into the path the agent uses.
 * Undefined where the path is open, and for the app's internals, which the
 * agent meets as missing rather than refused.
 */
export function ruleRefusal({
  asks = true,
  hostPath,
  op,
  rules,
  spell,
}: {
  /**
   * Whether running into it raises a card. A walk that passes a closed
   * folder on its way is not asking for it.
   */
  asks?: boolean;
  hostPath: string;
  op: "read" | "write";
  rules: Rules;
  spell: (hostPath: string) => string;
}): string | undefined {
  const reach = reachOf(rules, hostPath, op);
  if (reach.level === "allow" || reach.level === "hidden") {
    return undefined;
  }
  if (reach.level === "never") {
    return reach.rule?.level === "readOnly"
      ? `${spell(hostPath)} is read-only. Copy what you need out of it and change the copy.`
      : `${spell(hostPath)} is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
  }
  const folder = folderToAskFor({
    home: rules.home,
    hostPath,
    isDirectory: false,
    rule: reach.rule,
  });
  // The home folder or the disk whole is never the thing to ask for.
  if (
    !asks ||
    !rules.asker ||
    folder === rules.home ||
    folder === nodePath.parse(folder).root
  ) {
    return `${spell(hostPath)} needs the person's yes first.`;
  }
  raiseAsk(rules.asker, "folder", folder);
  return waitingNote(spell(folder));
}

/**
 * Wrap a folder mount so the rules decide what in it the agent may read and
 * change. Listings and file contents are reads; stat and exists answer, so a
 * listing of the folder around a closed one still shows it. Paths arrive
 * already resolved and relative to the mount, as `MountableFs` routes them.
 */
export function rulesFs({
  delegate,
  hostRoot,
  onRefusal,
  rules,
  spell,
}: {
  delegate: IFileSystem;
  hostRoot: string;
  /**
   * Hears each refusal, since a shell builtin reports any failed read as a
   * missing file and the agent would never learn why.
   */
  onRefusal?: (refusal: string, refusedPath: string) => void;
  rules: Rules;
  spell: (hostPath: string) => string;
}): IFileSystem {
  const hostOf = (mountPath: string) => nodePath.join(hostRoot, mountPath);
  let listings = 0;
  const isHidden = (mountPath: string) =>
    reachOf(rules, hostOf(mountPath), "read").level === "hidden";
  const check = (
    op: "read" | "write",
    syscall: string,
    mountPath: string,
    asks = true,
  ) => {
    if (isHidden(mountPath)) {
      throw Object.assign(
        new Error(
          `ENOENT: no such file or directory, ${syscall} '${spell(hostOf(mountPath))}'`,
        ),
        { code: "ENOENT" },
      );
    }
    const refusal = ruleRefusal({
      asks,
      hostPath: hostOf(mountPath),
      op,
      rules,
      spell,
    });
    if (refusal) {
      onRefusal?.(refusal, spell(hostOf(mountPath)));
      throw Object.assign(
        new Error(
          `EACCES: permission denied, ${syscall} '${spell(hostOf(mountPath))}' -- ${refusal}`,
        ),
        { code: "EACCES" },
      );
    }
  };
  const reads = new Set([
    "readFile",
    "readFileBuffer",
    "readFileBytes",
    "readlink",
  ]);
  const writes = new Set([
    "appendFile",
    "chmod",
    "mkdir",
    "rm",
    "utimes",
    "writeFile",
  ]);
  return new Proxy(delegate, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || typeof value !== "function") {
        return value;
      }
      const call = (...args: unknown[]): unknown =>
        Reflect.apply(value, target, args);
      if (key === "exists") {
        return async (mountPath: string) =>
          !isHidden(mountPath) && (await call(mountPath)) === true;
      }
      if (key === "stat" || key === "lstat" || key === "realpath") {
        return async (...args: unknown[]) => {
          if (isHidden(String(args[0]))) {
            check("read", key, String(args[0]));
          }
          return call(...args);
        };
      }
      if (key === "readdir" || key === "readdirWithFileTypes") {
        return async (...args: unknown[]) => {
          const dir = String(args[0]);
          // The first listing a shell makes is the folder it was asked to
          // list; a later one is a walk passing through, which raises no
          // card for every closed folder it meets.
          const named = listings === 0;
          listings++;
          check("read", key, dir, named);
          const listed = await call(...args);
          // The app's internals are left out of a listing, the way a missing
          // folder would be.
          return Array.isArray(listed)
            ? listed.filter((entry: unknown) => {
                const name =
                  typeof entry === "string"
                    ? entry
                    : typeof entry === "object" &&
                        entry !== null &&
                        "name" in entry
                      ? entry.name
                      : undefined;
                return (
                  typeof name !== "string" ||
                  !isHidden(nodePath.posix.join(dir, name))
                );
              })
            : listed;
        };
      }
      if (reads.has(key) || writes.has(key)) {
        return async (...args: unknown[]) => {
          check(reads.has(key) ? "read" : "write", key, String(args[0]));
          return call(...args);
        };
      }
      if (key === "cp" || key === "mv" || key === "link" || key === "symlink") {
        return async (...args: unknown[]) => {
          const [first, second] = args.map(String);
          if (key !== "symlink") {
            check(key === "mv" ? "write" : "read", key, first ?? "");
          }
          check("write", key, second ?? "");
          return call(...args);
        };
      }
      if (key === "getAllPaths") {
        return () => {
          const all = call();
          return Array.isArray(all)
            ? all.filter(
                (entry) =>
                  typeof entry === "string" &&
                  reachOf(rules, hostOf(entry), "read").level === "allow",
              )
            : all;
        };
      }
      return call;
    },
  });
}
