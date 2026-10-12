import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { APP_NAME } from "@instrument-org/shared";
import { AsyncLocalStorage } from "node:async_hooks";

import { canonicalizeThroughMissing } from "./host-path";
import { raiseAsk, waitingNote } from "./permissions/asks";
import { isClosedDiskRoot } from "./disk-root";
import { DANGEROUS_NAMES, placePaths } from "./permissions/places";
import {
  folderToAskFor,
  levelWithoutAsking,
  type Reach,
  reachOf,
  type Rules,
  SOURCE_RANK,
} from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** The app's own environment, read live, as any process's. */
const appEnv: NodeJS.ProcessEnv = process.env;

/**
 * Places in the home folder a native command still writes whatever the
 * rules say. The app's own pnpm, uv and node-gyp keep their stores, caches
 * and config in the app's folders (`tool-isolation.ts`, `uv.ts`), never the
 * person's, so only the system's own caches stay open here, for the
 * frameworks a native tool loads.
 */
const TOOL_CACHES = [
  // The system's own caches, which frameworks a native tool loads write to.
  "Library/Caches",
];
const TOOL_SETTINGS: string[] = [];

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
  const passwords = placePaths(home).find((place) => place.id === "passwords");
  return [
    ...(passwords?.paths ?? []),
    ...(passwords?.closedUnlessAllowed ?? []),
  ];
}

/**
 * Whether a command held to `reach` may use the person's SSH keys, and so
 * their ssh-agent: the rules allow `~/.ssh`, by a grant in the chat or a
 * rule in Settings.
 */
export function reachesSshKeys(reach: NativeReach): boolean {
  const { home } = reach.rules;
  return (
    reachOf(reach.rules, path.join(home, ".ssh"), "read").level === "allow"
  );
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
export function seatbeltProfile(
  reach: NativeReach,
  /** The ssh-agent's socket the app was started with, if any. */
  agentSocket = appEnv.SSH_AUTH_SOCK,
): string {
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
    const level = levelWithoutAsking(rule.level, rule, withoutAsking);
    const filter = (spelled: string) =>
      rule.dotEntries
        ? `(regex #"^${regexEscape(spelled)}/\\.[^/]+(/|$)")`
        : `(subpath ${sbplString(spelled)})`;
    // A read-only folder opens for reading and closes to changes; the two
    // rules sit at one depth, in that order.
    const texts = (spelled: string) =>
      level === "allow"
        ? [`(allow file-read* file-write* ${filter(spelled)})`]
        : level === "readOnly"
          ? [
              `(allow file-read* ${filter(spelled)})`,
              `(deny file-write* ${filter(spelled)})`,
            ]
          : [`(deny file-read* file-write* ${filter(spelled)})`];
    entries.push(
      ...spellings(rule.path).flatMap((spelled) =>
        texts(spelled).map((text) => ({
          depth: depthOf(rule.path) + (rule.dotEntries ? 1 : 0),
          opened:
            level !== "allow" && level !== "readOnly"
              ? undefined
              : rule.dotEntries
                ? undefined
                : spelled,
          rank: SOURCE_RANK[rule.source],
          text,
        })),
      ),
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
  // A closed folder stays closed only where it is: renaming a folder above
  // it would carry it out from under its rule, so the folders above every
  // closed one are kept from being moved or removed. Creating and changing
  // what is in them is a different path and stays as the rules say.
  const closedAbove = new Set<string>();
  for (const rule of rules) {
    const level = levelWithoutAsking(rule.level, rule, withoutAsking);
    if (level === "allow" || level === "readOnly" || rule.dotEntries) {
      continue;
    }
    for (const spelled of spellings(rule.path)) {
      for (
        let folder = path.dirname(spelled);
        folder !== path.dirname(folder);
        folder = path.dirname(folder)
      ) {
        closedAbove.add(folder);
      }
    }
  }
  const texts = [
    ...ordered.map((e) => e.text),
    ...[...closedAbove]
      .toSorted()
      .map((folder) => `(deny file-write* (literal ${sbplString(folder)}))`),
  ];
  // The Keychain is reached through a service rather than a file, so a closed
  // Keychains folder closes the service too. Certificate checks go through a
  // different one, so https still works.
  const keychains = path.join(home, "Library", "Keychains");
  if (
    rules.some(
      (rule) =>
        rule.place === "passwords" &&
        rule.path === keychains &&
        rule.level !== "allow",
    )
  ) {
    texts.push(
      '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))',
    );
  }
  // The ssh-agent holds the keys in ~/.ssh unlocked, so it opens with that
  // folder: connecting to its socket is refused until then, and allowed
  // then wherever the socket lives, a link to it in a closed folder included.
  if (agentSocket && path.isAbsolute(agentSocket)) {
    const socket = spellings(agentSocket).map(
      (spelled) => `(literal ${sbplString(spelled)})`,
    );
    texts.push(
      reachesSshKeys(reach)
        ? `(allow file-read* network-outbound ${socket.join(" ")})`
        : `(deny network-outbound ${socket.join(" ")})`,
    );
  }
  // A name that runs code when its folder is used stays closed to changes
  // everywhere but the app's own folders.
  const ownFolders = reach.readWrite.flatMap(spellings);
  texts.push(
    `(deny file-write* (require-all (require-any ${DANGEROUS_NAMES.map(
      (name) => `(regex #"/${regexEscape(name)}(/|$)")`,
    ).join(" ")}) ${ownFolders
      .map((own) => `(require-not (subpath ${sbplString(own)}))`)
      .join(" ")}))`,
  );
  // No Apple Events and no opening apps: a command could otherwise have
  // another app do what the profile keeps it from, outside any sandbox.
  // osascript reaches an app only when the person allowed that app, and then
  // runs unwrapped (osascript.ts).
  texts.push(
    "(deny appleevent-send)",
    "(deny lsopen)",
    '(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))',
  );
  return ["(version 1)", "(allow default)", ...texts].join("\n");
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
  /** Null runs the command unwrapped, for an app the person allowed. */
  reach: NativeReach | null | undefined = currentReach(),
): { args: string[]; file: string; reach?: NativeReach } {
  // A binary that is not there is left to fail as itself, so the shim's
  // not-found diagnostic names it rather than sandbox-exec's execvp error.
  if (!reach || (path.isAbsolute(file) && !existsSync(file))) {
    return { args: [...args], file };
  }
  if (seatbeltAvailable()) {
    return {
      args: ["-p", seatbeltProfile(reach), file, ...args],
      file: SANDBOX_EXEC,
      reach,
    };
  }
  if (bwrapAvailable()) {
    return {
      args: [...bwrapArgs(reach), "--", file, ...args],
      file: BWRAP,
      reach,
    };
  }
  return { args: [...args], file };
}

const BWRAP = "/usr/bin/bwrap";

let bwrapWorks: boolean | undefined;

/**
 * Whether bubblewrap can make a sandbox from this process: Linux with bwrap
 * installed and user namespaces open to it. Ubuntu closes them to
 * unprivileged programs, and the app's own AppArmor profile, which the
 * `.deb` installs, opens them for the app and what it starts.
 */
export function bwrapAvailable(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (bwrapWorks === undefined) {
    try {
      execFileSync(
        BWRAP,
        ["--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev", "/usr/bin/true"],
        { stdio: "ignore", timeout: 5000 },
      );
      bwrapWorks = true;
    } catch {
      bwrapWorks = false;
    }
  }
  return bwrapWorks;
}

/**
 * bubblewrap's arguments for the rules: the whole system as it is, the home
 * folder read-only, then each rule's folder bound over it from shallow to
 * deep, the way the Seatbelt profile orders its rules. A closed folder is an
 * empty one in its place and a closed file is empty; a folder that opens
 * inside a closed one is bound back over the empty one.
 *
 * Hidden entries in the home folder have no pattern form here, so the home
 * folder is listed and each one is closed by name.
 */
export function bwrapArgs(reach: NativeReach): string[] {
  const { home, rules, withoutAsking } = reach.rules;
  const entries: {
    access: "none" | "read" | "write";
    depth: number;
    path: string;
    rank: number;
  }[] = [];
  const add = (
    target: string,
    access: "none" | "read" | "write",
    rank: number,
  ) => {
    entries.push({ access, depth: depthOf(target), path: target, rank });
  };
  add(home, "read", -1);
  for (const rule of rules) {
    const level = levelWithoutAsking(rule.level, rule, withoutAsking);
    const access =
      level === "allow" ? "write" : level === "readOnly" ? "read" : "none";
    const targets = rule.dotEntries ? dotEntriesIn(rule.path) : [rule.path];
    for (const target of targets) {
      add(target, access, SOURCE_RANK[rule.source]);
    }
  }
  const tools = toolPlaces(home);
  for (const opened of [...tools.caches, ...reach.readWrite]) {
    add(opened, "write", 3);
  }
  for (const opened of [...tools.settings, ...reach.readOnly]) {
    add(opened, "read", 3);
  }
  // bubblewrap has no pattern for a name that runs code when its folder is
  // used, so the ones already at the top of each allowed folder of the
  // person's are bound read-only by name.
  for (const rule of rules) {
    if (rule.level !== "allow" || rule.source === "system") {
      continue;
    }
    for (const name of DANGEROUS_NAMES) {
      add(path.join(rule.path, name), "read", 4);
    }
  }
  const args = [
    "--ro-bind",
    "/",
    "/",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
    "--bind",
    "/tmp",
    "/tmp",
    "--die-with-parent",
  ];
  const ordered = entries.toSorted(
    (a, b) => a.depth - b.depth || a.rank - b.rank,
  );
  // A tool's cache or the chat's own folder that is not there yet is made
  // before it is bound, so a first run on a new computer can write it: an
  // unbound folder would stay read-only with the home folder around it.
  const ours = new Set([...tools.caches, ...reach.readWrite]);
  for (const entry of ordered) {
    const real = resolveReal(entry.path);
    if (!existsSync(real) && ours.has(entry.path)) {
      try {
        mkdirSync(real, { recursive: true });
      } catch {
        // Left unbound, as a folder that could not be made.
      }
    }
    if (!existsSync(real)) {
      continue;
    }
    if (entry.access === "write") {
      args.push("--bind", real, real);
    } else if (entry.access === "read") {
      args.push("--ro-bind", real, real);
    } else if (statSync(real).isDirectory()) {
      // An empty folder that refuses to be listed or read, so a program
      // meets "permission denied" there rather than an empty or missing
      // folder it would take at face value. A folder opened inside it keeps
      // search permission, which reaching that folder needs.
      const opensInside = ordered.some(
        (other) =>
          other.access !== "none" &&
          other.depth > entry.depth &&
          other.path.startsWith(`${entry.path}${path.sep}`),
      );
      args.push("--perms", opensInside ? "0111" : "0000", "--tmpfs", real);
    } else {
      // A file nobody may open, in place of the closed one, so reading it
      // is refused rather than empty.
      args.push("--ro-bind", unreadableFile(), real);
    }
  }
  return args;
}

/**
 * An empty file with no permissions, bound over a closed file. Made once in
 * the system's temp folder, which every sandboxed command already reaches.
 */
function unreadableFile(): string {
  const file = path.join(
    os.tmpdir(),
    `instrument-closed-${process.getuid?.() ?? 0}`,
  );
  if (!existsSync(file)) {
    writeFileSync(file, "", { mode: 0o000 });
  }
  chmodSync(file, 0o000);
  return file;
}

function dotEntriesIn(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.startsWith("."))
      .map((name) => path.join(folder, name));
  } catch {
    return [];
  }
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

const REFUSALS = [
  "not permitted",
  "Permission denied",
  "No such file",
  "Read-only file system",
];

/**
 * The first path a failed command's output says it was not permitted to use
 * that the rules keep from it, so the agent is told why rather than left to
 * read a bare "Operation not permitted" as something to work around.
 */
export function refusedPathIn(
  output: string,
  reach: NativeReach,
  /** The command's working folder, which a relative path is read against. */
  cwd?: string,
): undefined | { hostPath: string; reach: Reach; rules: Rules } {
  for (const line of output.split("\n")) {
    // Seatbelt refuses with "Operation not permitted"; bubblewrap leaves a
    // closed folder empty and a home folder read-only, so the same refusal
    // reads as a missing file or a read-only disk there.
    if (!REFUSALS.some((refusal) => line.includes(refusal))) {
      continue;
    }
    // The path refused is the last one a line names: a shell names itself
    // first (`/bin/sh: 1: cannot create <path>`). A program names a path
    // the way it was given, so `closed/a.txt` is read against the cwd.
    for (const match of [
      ...line.matchAll(/(?<=^|[\s:'"`(=[])[^\s:'"`]*\/[^\s:'"`]*/g),
    ].toReversed()) {
      const named = match[0];
      if (!path.isAbsolute(named) && cwd === undefined) {
        continue;
      }
      const hostPath = path.resolve(cwd ?? "/", named);
      // A missing file can only be a closed read; anything else may have
      // been a change.
      const decided = reachOf(
        reach.rules,
        hostPath,
        line.includes("No such file") ? "read" : "write",
      );
      if (decided.level !== "allow") {
        return { hostPath, reach: decided, rules: reach.rules };
      }
    }
  }
  return undefined;
}

/** What the agent reads when the rules stopped a native command. */
export function refusalNote(
  refused: { hostPath: string; reach: Reach; rules: Rules },
  home = os.homedir(),
): string {
  const shown = (shownPath: string) =>
    shownPath.startsWith(`${home}/`)
      ? `~/${shownPath.slice(home.length + 1)}`
      : shownPath;
  if (refused.reach.rule?.denied) {
    return `The person said not now to ${shown(refused.hostPath)} in this chat. Don't look for another way in; say what you skipped without it.`;
  }
  if (refused.reach.level === "never") {
    return `${shown(refused.hostPath)} is closed to ${APP_NAME} in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.`;
  }
  const folder = folderToAskFor({
    home,
    hostPath: refused.hostPath,
    isDirectory: false,
    rule: refused.reach.rule,
  });
  // The home folder or the disk whole is never the thing to ask for.
  if (
    !refused.rules.asker ||
    folder === refused.rules.home ||
    isClosedDiskRoot(folder)
  ) {
    return `${shown(refused.hostPath)} needs the person's yes first.`;
  }
  raiseAsk(refused.rules.asker, "folder", folder);
  return `${waitingNote(shown(folder))} Run the command again once they allow it.`;
}
