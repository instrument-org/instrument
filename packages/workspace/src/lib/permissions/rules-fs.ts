import { APP_NAME } from "@instrument-org/shared";
import { DefenseInDepthBox, type IFileSystem } from "just-bash";
import { existsSync } from "node:fs";
import nodePath from "node:path";

import { FOLDER_VARIABLES } from "../../constants";
import { canonicalizeThroughMissing, withoutDataVolume } from "../host-path";
import { accountCanWrite, systemOwnedNote } from "./account-can-write";
import { askFirstNote, macosRefusalNote } from "../chat/asks";
import {
  MACOS_ASKING_MS,
  macosGuardedRoot,
  noteMacosFolderAnswer,
  raiseMacosAsking,
} from "./macos";
import { isClosedDiskRoot } from "../disk-root";
import {
  folderToAskFor,
  holdsAppData,
  type Reach,
  reachOf,
  type Rules,
} from "./rules";

/**
 * What the agent reads when the rules keep it from a path, naming the folder
 * to ask for where the person can open it: the one answer for the shell's own
 * commands, the file tools, and the commands that check their operands. `spell` turns a host path into the
 * path the agent uses, which the note quotes as a JSON string, so a name
 * that reads as words to the agent (one taken from a download or an
 * archive) stays a name. Undefined where the path is open.
 */
export function ruleRefusal({
  asks = true,
  hostPath: given,
  isDirectory = false,
  onDisk = false,
  op,
  reach: decided,
  rules,
  spell,
}: {
  /**
   * Whether the note says what to ask for. A walk that passes a closed
   * folder on its way is not after it.
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
  op: "list" | "read" | "write";
  /** What the rules make of the path, where the caller decided it already. */
  reach?: Reach;
  rules: Rules;
  spell: (hostPath: string) => string;
}): string | undefined {
  const hostPath = withoutDataVolume(given);
  const reach = decided ?? reachOf(rules, hostPath, op);
  if (reach.level === "allow") {
    return undefined;
  }
  const shown = (shownPath: string) => JSON.stringify(spell(shownPath));
  if (reach.level === "never") {
    return closedNote(reach, shown(hostPath));
  }
  if (op === "write" && !accountCanWrite(hostPath)) {
    return systemOwnedNote(shown(hostPath));
  }
  const asked = askableFolder({
    hostPath,
    isDirectory,
    onDisk,
    rule: reach.rule,
    rules,
    shown,
  });
  if ("refusal" in asked) {
    return asked.refusal;
  }
  if (!asks || !rules.asker) {
    return `${shown(hostPath)} needs the person's yes first.`;
  }
  return askFirstNote(shown(hostPath), shown(asked.folder));
}

/**
 * The folder a card opens to reach `hostPath`, or why no card can: the home
 * folder, a disk's root, and a folder holding the app's own data are never
 * asked for whole. `onDisk` takes the nearest folder that exists.
 */
export function askableFolder({
  hostPath,
  isDirectory,
  onDisk,
  rule,
  rules,
  shown,
}: {
  hostPath: string;
  isDirectory: boolean;
  onDisk: boolean;
  rule: Reach["rule"];
  rules: Rules;
  shown: (hostPath: string) => string;
}): { folder: string } | { refusal: string } {
  let folder = folderToAskFor({ hostPath, isDirectory, rule, rules });
  while (onDisk && !existsSync(folder) && folder !== nodePath.dirname(folder)) {
    folder = nodePath.dirname(folder);
  }
  // The home folder or the disk whole is never the thing to ask for.
  if (folder === rules.home || isClosedDiskRoot(folder)) {
    return {
      refusal: `${shown(hostPath)} is directly in ${shown(folder)}, which can't be asked for whole. Work in your work folder, or a folder the person names.`,
    };
  }
  // Nor is a folder that holds the app's own data, which no yes opens.
  if (holdsAppData(rules, folder)) {
    return {
      refusal: `${shown(hostPath)} is in ${shown(folder)}, which holds ${APP_NAME}'s own data, so it can't be asked for whole. Work in your work folder, or a folder the person names.`,
    };
  }
  return { folder };
}

/**
 * What the agent reads about a path the rules never open to it this way,
 * by why: a path through an NTFS stream, the person's not now in this chat, a folder only read, a file
 * that runs when they log in, or a place closed in Settings. Only the last
 * is something a setting changes, so only it sends the person there.
 */
export function closedNote(reach: Reach, shown: string): string {
  if (reach.stream) {
    return `${shown} names a file or folder by one of its streams (the part after a ":"), a second name no rule opens. Use its own path.`;
  }
  const rule = reach.rule;
  if (rule?.appData) {
    return `${shown} is ${APP_NAME}'s own data, which no command reads or changes; don't look for another way in. Your work folder ($${FOLDER_VARIABLES.work}) and this conversation's own folder ($${FOLDER_VARIABLES.output}) stay open to you, and a file the person sent is read where they keep it.`;
  }
  if (rule?.denied) {
    return `${shown}: the person said not now to this folder in this chat. Don't look for another way in; say what you skipped without it.`;
  }
  if (rule?.level === "readOnly") {
    return `${shown} is read-only. Copy what you need out of it and change the copy.`;
  }
  if (rule?.source === "system" && rule.level === "never") {
    return `${shown} runs every time the person logs in or opens a terminal, so it is never changed for them, whatever their settings. Tell them what to add and they can add it themselves.`;
  }
  return `${shown} is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
}

/**
 * How many folders the command running now has listed, shared by every
 * folder's filesystem in one shell, which starts it over as each command
 * starts. The first is the folder the command was asked to list; a later
 * one is a walk passing through, which is told of no folder to ask for
 * at every closed one it meets.
 */
export interface Listings {
  count: number;
}

/**
 * Wrap a folder mount so the rules decide what in it the agent may read and
 * change. File contents are reads and listings are lists, which a listed
 * place allows; stat and exists answer, so a listing of the folder around a
 * closed one still shows it. Paths arrive
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
  const check = (
    op: "list" | "read" | "write",
    syscall: string,
    mountPath: string,
    asks = true,
  ) => {
    const shown = spell(given(mountPath));
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
  // Every method that changes the filesystem, by the name just-bash gives it.
  // `createExclusive` is the one that does not read as a write: it is what
  // `mktemp` names its file with, so leaving it out let an entry be made
  // wherever the rules close, with no card and no refusal. A method added to
  // the interface and not to this set falls through unchecked, which is why
  // the list is of the whole interface rather than of what we expect.
  const writes = new Set([
    "appendFile",
    "chmod",
    "createExclusive",
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
      // What the rules allowed and macOS refused anyway: the system's own
      // privacy settings, which the agent hears of beside the bare error so
      // it asks for the folder instead of guessing at what blocked it. One
      // that waits in a folder macOS guards is macOS asking the person, which
      // the chat's card says while it waits, rather than a quiet stall.
      const macosRefused = async (
        mountPath: string,
        run: () => unknown,
        {
          isListing = false,
          isRead = true,
        }: { isListing?: boolean; isRead?: boolean } = {},
      ) => {
        const pending = Promise.resolve().then(run);
        // A listing is what waits on macOS's prompt for its folder, and one
        // in a folder macOS guards has no other reason to take a second; a
        // read of a big file can, so a read raises nothing. Looking at the
        // folder again to be sure would hold one more of the process's file
        // threads for as long as the prompt is up.
        const root =
          rules.asker === undefined || !isListing
            ? undefined
            : macosGuardedRoot(given(mountPath));
        if (rules.asker !== undefined && root !== undefined) {
          const asker = rules.asker;
          // The app's own timer, which just-bash blocks a running script
          // from setting, so it is set and cleared as trusted host code.
          const timer = DefenseInDepthBox.runTrusted(() =>
            setTimeout(() => {
              void DefenseInDepthBox.runTrustedAsync(() =>
                raiseMacosAsking(asker, root),
              ).catch(() => {});
            }, MACOS_ASKING_MS),
          );
          void pending
            .finally(() => {
              DefenseInDepthBox.runTrusted(() => {
                clearTimeout(timer);
              });
            })
            .catch(() => {});
        }
        try {
          const answered = await pending;
          // A new file is written while macOS is still asking, so only a
          // read or listing that answered says it let the app in.
          if (isRead) {
            noteMacosFolderAnswer(given(mountPath), "allowed");
          }
          return answered;
        } catch (error) {
          // just-bash's own filesystem rethrows a refusal as a plain error
          // whose message starts with the code, leaving no `code` on it.
          if (
            process.platform === "darwin" &&
            error instanceof Error &&
            (("code" in error && error.code === "EPERM") ||
              error.message.startsWith("EPERM:"))
          ) {
            noteMacosFolderAnswer(given(mountPath), "denied");
            onRefusal?.(
              macosRefusalNote(JSON.stringify(spell(given(mountPath)))),
            );
          }
          throw error;
        }
      };
      if (key === "readdir" || key === "readdirWithFileTypes") {
        return async (...args: unknown[]) => {
          const dir = String(args[0]);
          const named = listings.count === 0;
          listings.count++;
          check("list", key, dir, named);
          return named
            ? macosRefused(dir, () => call(...args), { isListing: true })
            : call(...args);
        };
      }
      if (reads.has(key) || writes.has(key)) {
        return async (...args: unknown[]) => {
          check(reads.has(key) ? "read" : "write", key, String(args[0]));
          return macosRefused(String(args[0]), () => call(...args), {
            isRead: reads.has(key),
          });
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
                    (host) => reachOf(rules, host, "list").level === "allow",
                  ),
              )
            : all;
        };
      }
      return call;
    },
  });
}
