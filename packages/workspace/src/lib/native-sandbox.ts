import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { APP_NAME } from "@instrument-org/shared";
import { AsyncLocalStorage } from "node:async_hooks";

import { canonicalizeThroughMissing } from "./host-path";
import { placePaths } from "./permissions/places";
import { folderToAskFor, type Reach, reachOf, type Rules } from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * Places in the home folder that native tools keep as their own: caches and
 * package stores they write, and the settings they read on start. A command
 * held out of the person's folders still has to install a package or warm a
 * cache, so these stay open whatever the rules say about the places around
 * them. The settings stay read-only, since a command that rewrote them could
 * change what the person's own tools do next.
 */
const TOOL_CACHES = [
  ".cache",
  ".npm",
  ".local/share/uv",
  ".local/share/pnpm",
  ".local/state",
  "Library/Caches",
  "Library/pnpm",
];
const TOOL_SETTINGS = [
  ".npmrc",
  ".gitconfig",
  ".config/git",
  ".config/uv",
  ".config/pip",
];

/** The places native tools keep as their own, in `home`. */
export function toolPlaces(home = os.homedir()): {
  caches: string[];
  settings: string[];
} {
  const inHome = (names: string[]) =>
    names.map((place) => path.join(home, place));
  return { caches: inHome(TOOL_CACHES), settings: inHome(TOOL_SETTINGS) };
}

/**
 * The paths a native command may not read or write when nothing narrower
 * applies: the passwords and sign-ins place, as the built-in rules spell it.
 */
export function credentialPlaces(home = os.homedir()): string[] {
  return placePaths(home).find((place) => place.id === "passwords")?.paths ?? [];
}

/** What a native command spawned for a chat is held to. */
export interface NativeReach {
  /** Folders the command may read but not change, such as the skills. */
  readOnly: readonly string[];
  /** Folders the command may change whatever the rules say: its chat's own. */
  readWrite: readonly string[];
  rules: Rules;
}

const reachStorage = new AsyncLocalStorage<NativeReach>();

/** Runs `run` with every native command it spawns held to `reach`. */
export function withNativeReach<T>(reach: NativeReach, run: () => T): T {
  return reachStorage.run(reach, run);
}

/**
 * A Seatbelt profile from the rules. Allow-by-default keeps every system
 * directory, device and service a binary expects where it was; then, ordered
 * shallow to deep because Seatbelt lets the last matching rule win, nothing in
 * the home folder may be changed, and each rule opens or closes its folder.
 * So a folder allowed inside a place that asks is open, and a folder closed
 * inside it is closed again, the same as `reachOf` decides.
 *
 * Seatbelt compares real paths, so each one is resolved through any symlink
 * first, including a missing path under a linked folder.
 */
export function seatbeltProfile(reach: NativeReach): string {
  const { home, rules, withoutAsking } = reach.rules;
  const entries: {
    depth: number;
    /** The folder the entry opens, for an allow. */
    opened?: string;
    rank: number;
    text: string;
  }[] = [
    {
      depth: depthOf(home),
      rank: -1,
      text: `(deny file-write* (subpath ${sbplString(resolveReal(home))}))`,
    },
  ];
  for (const rule of rules) {
    const level = rule.level === "ask" && withoutAsking ? "allow" : rule.level;
    const access = "file-read* file-write*";
    entries.push(
      ...spellings(rule.path).map((spelled) => ({
        depth: depthOf(rule.path) + (rule.dotEntries ? 1 : 0),
        opened: level === "allow" && !rule.dotEntries ? spelled : undefined,
        rank: { folder: 1, grant: 2, place: 0 }[rule.source],
        text: `(${level === "allow" ? "allow" : "deny"} ${access} ${
          rule.dotEntries
            ? `(regex #"^${regexEscape(spelled)}/\\.[^/]+(/|$)")`
            : `(subpath ${sbplString(spelled)})`
        })`,
      })),
    );
  }
  const opens = (paths: readonly string[], access: string) =>
    paths.flatMap((opened) =>
      spellings(opened).map((spelled) => ({
        depth: depthOf(opened),
        opened: spelled,
        rank: 3,
        text: `(allow ${access} (subpath ${sbplString(spelled)}))`,
      })),
    );
  const tools = toolPlaces(home);
  entries.push(
    ...opens(tools.caches, "file-read* file-write*"),
    ...opens(tools.settings, "file-read*"),
    ...opens(reach.readOnly, "file-read*"),
    ...opens(reach.readWrite, "file-read* file-write*"),
  );
  const ordered = entries.toSorted(
    (a, b) => a.depth - b.depth || a.rank - b.rank,
  );
  // A tool opening a file in an open folder looks at each folder above it on
  // the way (sqlite and `mkdir -p` both do), so those answer what they are
  // without listing what is in them.
  const above = new Set<string>();
  for (const { opened } of ordered) {
    for (
      let folder = opened && path.dirname(opened);
      folder && folder !== path.dirname(folder);
      folder = path.dirname(folder)
    ) {
      above.add(folder);
    }
  }
  ordered.push(
    ...[...above].toSorted().map((folder) => ({
      depth: 0,
      rank: 0,
      text: `(allow file-read-metadata (literal ${sbplString(folder)}))`,
    })),
  );
  return ["(version 1)", "(allow default)", ...ordered.map((e) => e.text)].join(
    "\n",
  );
}

function depthOf(hostPath: string): number {
  return path.resolve(hostPath).split(path.sep).filter(Boolean).length;
}

function resolveReal(target: string): string {
  return canonicalizeThroughMissing(target) ?? target;
}

/**
 * A path as written and, where a link is on the way, where it really is.
 * Seatbelt checks both the link it opens through and what it lands on, so a
 * rule names the two.
 */
function spellings(target: string): string[] {
  const written = path.resolve(target);
  const real = resolveReal(target);
  return real === written ? [written] : [written, real];
}

function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function regexEscape(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let available: boolean | undefined;

/**
 * Whether a profile can be applied from this process. False off macOS, and on
 * macOS when this process is itself sandboxed (Seatbelt does not nest), which
 * is the case under some agent harnesses and in a test runner run inside one.
 */
export function seatbeltAvailable(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  if (available === undefined) {
    try {
      execFileSync(
        SANDBOX_EXEC,
        ["-p", "(version 1)(allow default)", "/usr/bin/true"],
        {
          stdio: "ignore",
          timeout: 5000,
        },
      );
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

/**
 * The command to spawn for a native binary, held to the chat's rules on macOS
 * when it runs for a chat, and out of the passwords place when it runs for
 * the app. Elsewhere, or when Seatbelt cannot apply, the command comes back
 * unchanged and `reach` is absent.
 */
export function wrapNativeCommand(
  file: string,
  args: readonly string[],
  reach: NativeReach | undefined = currentReach(),
): { args: string[]; file: string; reach?: NativeReach } {
  // A binary that is not there is left to fail as itself, so the shim's
  // not-found diagnostic names it rather than sandbox-exec's execvp error.
  if (
    !reach ||
    !seatbeltAvailable() ||
    (path.isAbsolute(file) && !existsSync(file))
  ) {
    return { args: [...args], file };
  }
  return {
    args: ["-p", seatbeltProfile(reach), file, ...args],
    file: SANDBOX_EXEC,
    reach,
  };
}

function currentReach(): NativeReach | undefined {
  const held = reachStorage.getStore();
  if (held) {
    return held;
  }
  if (!getWorkspaceConfig().nativeSandbox) {
    return undefined;
  }
  const home = os.homedir();
  return {
    readOnly: [],
    readWrite: [],
    rules: {
      home,
      rules: credentialPlaces(home).map((denied) => ({
        level: "never",
        path: denied,
        place: "passwords",
        source: "place",
      })),
      withoutAsking: false,
    },
  };
}

/**
 * The first path a failed command's output says it was not permitted to use
 * that the rules keep from it, so the agent is told why rather than left to
 * read a bare "Operation not permitted" as something to work around.
 */
export function refusedPathIn(
  output: string,
  reach: NativeReach,
): undefined | { hostPath: string; reach: Reach } {
  for (const line of output.split("\n")) {
    if (!line.includes("not permitted")) {
      continue;
    }
    for (const match of line.matchAll(/\/[^\s:'"`]+/g)) {
      const hostPath = match[0];
      const decided = reachOf(reach.rules, hostPath, "write");
      if (decided.level !== "allow") {
        return { hostPath, reach: decided };
      }
    }
  }
  return undefined;
}

/** What the agent reads when the rules stopped a native command. */
export function refusalNote(
  refused: { hostPath: string; reach: Reach },
  home = os.homedir(),
): string {
  const shown = (shownPath: string) =>
    shownPath.startsWith(`${home}/`)
      ? `~/${shownPath.slice(home.length + 1)}`
      : shownPath;
  if (refused.reach.level === "never") {
    return `${shown(refused.hostPath)} is closed to ${APP_NAME} in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
  }
  const folder = folderToAskFor({
    home,
    hostPath: refused.hostPath,
    isDirectory: false,
    rule: refused.reach.rule,
  });
  return `${shown(refused.hostPath)} needs the person's yes first. Ask for ${shown(folder)} with request_folder, then run the command again.`;
}
