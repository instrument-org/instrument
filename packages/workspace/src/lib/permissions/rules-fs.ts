import { type IFileSystem } from "just-bash";
import nodePath from "node:path";

import { folderToAskFor, reachOf, type Rules } from "./rules";

/**
 * What the agent reads when the rules keep it from a path, spelled the way it
 * reaches things: `spell` turns a host path into its mount path.
 */
export function ruleRefusal({
  hostPath,
  op,
  rules,
  spell,
}: {
  hostPath: string;
  op: "read" | "write";
  rules: Rules;
  spell: (hostPath: string) => string;
}): string | undefined {
  const reach = reachOf(rules, hostPath, op);
  if (reach.level === "allow") {
    return undefined;
  }
  if (reach.level === "never") {
    return `${spell(hostPath)} is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
  }
  const folder = folderToAskFor({
    home: rules.home,
    hostPath,
    isDirectory: false,
    rule: reach.rule,
  });
  return `${spell(hostPath)} needs the person's yes first. Ask for ${spell(folder)} with request_folder.`;
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
  onRefusal?: (refusal: string) => void;
  rules: Rules;
  spell: (hostPath: string) => string;
}): IFileSystem {
  const hostOf = (mountPath: string) => nodePath.join(hostRoot, mountPath);
  const check = (op: "read" | "write", syscall: string, mountPath: string) => {
    const refusal = ruleRefusal({
      hostPath: hostOf(mountPath),
      op,
      rules,
      spell,
    });
    if (refusal) {
      onRefusal?.(refusal);
      throw Object.assign(
        new Error(
          `EACCES: permission denied, ${syscall} '${spell(hostOf(mountPath))}' -- ${refusal}`,
        ),
        { code: "EACCES" },
      );
    }
  };
  const reads = new Set([
    "readdir",
    "readdirWithFileTypes",
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
