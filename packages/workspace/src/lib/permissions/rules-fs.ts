import { type IFileSystem } from "just-bash";
import { existsSync } from "node:fs";
import nodePath from "node:path";

import {
  canonicalizeThroughMissing,
  hostPathWithin,
  withoutDataVolume,
} from "../host-path";
import { accountCanWrite, systemOwnedNote } from "./account-can-write";
import { raiseAsk, waitingNote } from "./asks";
import { isClosedDiskRoot } from "../disk-root";
import { folderToAskFor, type Reach, reachOf, type Rules } from "./rules";

/**
 * What the agent reads when the rules keep it from a path, and the card it
 * raises where the person can open it: the one answer for the shell's own
 * commands, the file tools, the commands that check their operands, and the
 * programs the native profiles stopped. `spell` turns a host path into the
 * path the agent uses. Undefined where the path is open, and for the app's
 * internals, which the agent meets as missing rather than refused.
 */
export function ruleRefusal({
  afterAsk,
  asks = true,
  hostPath: given,
  isDirectory = false,
  onDisk = false,
  op,
  reach: decided,
  rules,
  spell,
}: {
  /** What to do once the card is up, said after the waiting note. */
  afterAsk?: string;
  /**
   * Whether running into it raises a card. A walk that passes a closed
   * folder on its way is not asking for it.
   */
  asks?: boolean;
  hostPath: string;
  /**
   * Whether the path names a folder, such as one being made, which a card
   * can ask for by itself even directly in the home folder.
   */
  isDirectory?: boolean;
  /**
   * Whether the card asks for a folder already on disk: the nearest one
   * holding the folder it would name. A path outside every folder the shell
   * reaches is opened by mounting what the card allows, which needs a
   * folder to mount.
   */
  onDisk?: boolean;
  op: "read" | "write";
  /** What the rules make of the path, where the caller decided it already. */
  reach?: Reach;
  rules: Rules;
  spell: (hostPath: string) => string;
}): string | undefined {
  const hostPath = withoutDataVolume(given);
  const reach = decided ?? reachOf(rules, hostPath, op);
  if (reach.level === "allow" || reach.level === "hidden") {
    return undefined;
  }
  if (reach.level === "never") {
    return closedNote(reach, spell(hostPath));
  }
  if (op === "write" && !accountCanWrite(hostPath)) {
    return systemOwnedNote(spell(hostPath));
  }
  let folder = folderToAskFor({
    home: rules.home,
    hostPath,
    isDirectory,
    rule: reach.rule,
  });
  while (onDisk && !existsSync(folder) && folder !== nodePath.dirname(folder)) {
    folder = nodePath.dirname(folder);
  }
  // The home folder or the disk whole is never the thing to ask for.
  if (folder === rules.home || isClosedDiskRoot(folder)) {
    return `${spell(hostPath)} is directly in ${spell(folder)}, which no card can open whole. Work in this conversation's folder, or a folder the person names.`;
  }
  if (!asks || !rules.asker) {
    return `${spell(hostPath)} needs the person's yes first.`;
  }
  raiseAsk(rules.asker, "folder", folder);
  const waiting = waitingNote(spell(folder));
  return afterAsk ? `${waiting} ${afterAsk}` : waiting;
}

/**
 * What the agent reads about a path the rules never open to it this way,
 * by why: the person's not now in this chat, a folder only read, a file
 * that runs when they log in, a name that runs code when its folder is
 * used, or a place closed in Settings. Only the last is something a
 * setting changes, so only it sends the person there.
 */
export function closedNote(reach: Reach, shown: string): string {
  const rule = reach.rule;
  if (rule?.denied) {
    return `${shown}: the person said not now to this folder in this chat. Don't look for another way in; say what you skipped without it.`;
  }
  if (rule?.level === "readOnly") {
    return `${shown} is read-only. Copy what you need out of it and change the copy.`;
  }
  if (rule?.source === "system" && rule.level === "never") {
    return `${shown} runs every time the person logs in or opens a terminal, so it is never changed for them, whatever their settings. Tell them what to add and they can add it themselves.`;
  }
  if (rule?.level !== "never") {
    return `${shown} makes code run when its folder is used (a git hook, .envrc, or an editor's or coding agent's settings), so it is never changed, moved or removed outside this chat's own folder. The rest of the folder, and git commands like commit and checkout, still work.`;
  }
  return `${shown} is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
}

/**
 * How many folders the command running now has listed, shared by every
 * folder's filesystem in one shell, which starts it over as each command
 * starts. The first is the folder the command was asked to list; a later
 * one is a walk passing through, which raises no card for every closed
 * folder it meets.
 */
export interface Listings {
  count: number;
}

/**
 * Wrap a folder mount so the rules decide what in it the agent may read and
 * change. Listings and file contents are reads; stat and exists answer, so a
 * listing of the folder around a closed one still shows it. Paths arrive
 * already resolved and relative to the mount, as `MountableFs` routes them.
 */
export function rulesFs({
  delegate,
  followsLinks = false,
  hostRoot,
  listings = { count: 0 },
  onRefusal,
  rules,
  spell,
}: {
  delegate: IFileSystem;
  /**
   * Whether the delegate follows a symlink to wherever it leads, so the
   * rules are asked of where a path really is as well as of the path.
   */
  followsLinks?: boolean;
  hostRoot: string;
  listings?: Listings;
  /**
   * Hears each refusal, since an error that crosses just-bash's sanitizer
   * loses its path and the agent would never learn which one was refused.
   */
  onRefusal?: (refusal: string) => void;
  rules: Rules;
  spell: (hostPath: string) => string;
}): IFileSystem {
  const given = (mountPath: string) => nodePath.join(hostRoot, mountPath);
  /** The path, and where it really leads when that is somewhere else. */
  const hostsOf = (mountPath: string): string[] => {
    const host = given(mountPath);
    const real = followsLinks ? canonicalizeThroughMissing(host) : null;
    return real === null || real === host ? [host] : [host, real];
  };
  const isHidden = (mountPath: string) =>
    hostsOf(mountPath).some(
      (host) => reachOf(rules, host, "read").level === "hidden",
    );
  // A hidden folder on the way to one the agent reaches (the workspace on
  // the way to the chat's folder) answers stat and exists, as the folders
  // above a mount do, so `cd` can pass through it. Its listing stays
  // missing.
  const leadsOn = (mountPath: string) =>
    hostsOf(mountPath).some((host) =>
      rules.rules.some((rule) => {
        if (rule.level === "hidden" || rule.dotEntries) {
          return false;
        }
        const within = hostPathWithin(host, rule.path);
        return within !== null && within !== "/";
      }),
    );
  const check = (
    op: "read" | "write",
    syscall: string,
    mountPath: string,
    asks = true,
  ) => {
    const shown = spell(given(mountPath));
    if (isHidden(mountPath)) {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, ${syscall} '${shown}'`),
        { code: "ENOENT" },
      );
    }
    for (const hostPath of hostsOf(mountPath)) {
      const refusal = ruleRefusal({
        asks,
        hostPath,
        isDirectory: syscall === "mkdir",
        op,
        rules,
        spell,
      });
      if (refusal) {
        // The refusal goes beside the command's output, whole; inside the
        // error some commands would print it a second time, with its paths
        // sanitized away.
        onRefusal?.(refusal);
        throw Object.assign(
          new Error(`EACCES: permission denied, ${syscall} '${shown}'`),
          { code: "EACCES" },
        );
      }
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
          (!isHidden(mountPath) || leadsOn(mountPath)) &&
          (await call(mountPath)) === true;
      }
      if (key === "stat" || key === "lstat" || key === "realpath") {
        return async (...args: unknown[]) => {
          if (isHidden(String(args[0])) && !leadsOn(String(args[0]))) {
            check("read", key, String(args[0]));
          }
          return call(...args);
        };
      }
      if (key === "readdir" || key === "readdirWithFileTypes") {
        return async (...args: unknown[]) => {
          const dir = String(args[0]);
          const named = listings.count === 0;
          listings.count++;
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
          // A move takes its source away, and a hard link is its source
          // under another name, so writing one writes the other: both
          // change the source. A copy and a symbolic link only read it.
          if (key !== "symlink") {
            check(
              key === "mv" || key === "link" ? "write" : "read",
              key,
              first ?? "",
            );
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
                  hostsOf(entry).every(
                    (host) => reachOf(rules, host, "read").level === "allow",
                  ),
              )
            : all;
        };
      }
      return call;
    },
  });
}
