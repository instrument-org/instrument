import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { AsyncLocalStorage } from "node:async_hooks";

import { COMMAND_LINE_TOOLS_INSTALLER } from "./command-line-tools-env";
import { canonicalizeThroughMissing, hostPathWithin } from "./host-path";
import { type MxcLaunch, mxcVerdict, sandboxStateDir } from "./mxc-canary";
import { ruleRefusal } from "./permissions/rules-fs";
import { DANGEROUS_NAMES, placePaths } from "./permissions/places";
import {
  levelWithoutAsking,
  type Reach,
  reachOf,
  ruleRank,
  type Rules,
} from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** The app's own environment, read live, as any process's. */
const appEnv: NodeJS.ProcessEnv = process.env;

/**
 * The places native tools keep as their own: macOS's per-user cache folder,
 * which the frameworks a native tool loads write to. ~/Library/Caches stays
 * as the rules say: other apps keep code there they run later outside any
 * sandbox (Playwright's browsers, Go's builds).
 */
function toolCaches(): string[] {
  const userCache = darwinUserCacheDir();
  return userCache ? [userCache] : [];
}

/**
 * The paths a native command may not read or write when nothing narrower
 * applies: the passwords and sign-ins place, as the built-in rules spell it.
 */
function credentialPlaces(home = os.homedir()): string[] {
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

/** The reach the running shell call holds its native commands to, if any. */
export function heldNativeReach(): NativeReach | undefined {
  return reachStorage.getStore();
}

/**
 * Where a process keeps what it writes besides files: the terminal, the
 * null device, its own descriptors. Changing a disk's device takes an
 * administrator, so the folder as a whole is open.
 */
const DEVICES = "/dev";

/**
 * The per-user cache folder macOS gives every program
 * (`DARWIN_USER_CACHE_DIR`), beside the temp folder it also gives
 * (`/var/folders/<id>/T`), and written to by the frameworks a native tool
 * loads. Undefined anywhere the temp folder is not laid out that way.
 */
function darwinUserCacheDir(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const temp = resolveReal(os.tmpdir());
  return path.basename(temp) === "T"
    ? path.join(path.dirname(temp), "C")
    : undefined;
}

/**
 * A Seatbelt profile from the rules. Allow-by-default keeps every system
 * directory, device and service a binary expects where it was; then, ordered
 * shallow to deep because Seatbelt lets the last matching rule win, nothing on
 * the disk may be changed, and each rule opens or closes its folder.
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
    { depth: 0, rank: -1, text: '(deny file-write* (subpath "/"))' },
    // Again at the home folder, so a folder allowed above it (a temp folder
    // holding a test's planted home) opens nothing in it.
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
    // A socket in a closed place is how another program hands out what the
    // place holds (1Password's or gpg's agent signs with keys the agent may
    // not read), so connecting to one is closed with it, as the ssh-agent's
    // is with ~/.ssh below. Other folders that ask first keep their sockets
    // open: a container runtime's lives in one.
    const socketsClosed =
      level === "never" || (rule.place === "passwords" && level !== "allow");
    // A read-only folder opens for reading and closes to changes; the two
    // rules sit at one depth, in that order.
    const texts = (spelled: string) =>
      level === "allow"
        ? [`(allow file-read* file-write* network-outbound ${filter(spelled)})`]
        : level === "readOnly"
          ? [
              `(allow file-read* ${filter(spelled)})`,
              `(deny file-write* ${filter(spelled)})`,
            ]
          : [
              `(deny file-read* file-write*${socketsClosed ? " network-outbound" : ""} ${filter(spelled)})`,
            ];
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
          rank: ruleRank(rule),
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
  entries.push(
    ...opens([DEVICES], "file-write*"),
    ...opens(toolCaches(), "file-read* file-write*"),
    ...opens(reach.readOnly, "file-read*"),
    // Closed to changes as well, so a rule that opens a folder holding one
    // (an Ask first place under folders-without-asking) does not open it.
    ...reach.readOnly.flatMap((closed) =>
      spellings(closed).map((spelled) => ({
        depth: depthOf(closed),
        rank: 3,
        text: `(deny file-write* (subpath ${sbplString(spelled)}))`,
      })),
    ),
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
  // everywhere but the app's own folders, and a repository's .git folder
  // stays where it is: renamed, its hooks would be outside the name that
  // closes them, and could be written and moved back. Nor can such a name be
  // hard linked to elsewhere, where writing the link would change it.
  const ownFolders = reach.readWrite.flatMap(spellings);
  const notOwn = ownFolders
    .map((own) => `(require-not (subpath ${sbplString(own)}))`)
    .join(" ");
  texts.push(
    `(deny file-write* file-link (require-all (require-any ${DANGEROUS_NAMES.map(
      (name) => `(regex #"/${regexEscape(name)}(/|$)")`,
    ).join(" ")}) ${notOwn}))`,
    `(deny file-write-unlink (require-all (regex #"/\\.git$") ${notOwn}))`,
  );
  // No Apple Events and no opening apps: a command could otherwise have
  // another app do what the profile keeps it from, outside any sandbox.
  // osascript reaches an app only when the person allowed that app, and then
  // runs unwrapped (osascript.ts).
  texts.push(
    "(deny appleevent-send)",
    "(deny lsopen)",
    '(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))',
    // The macOS developer tool stubs in /usr/bin (`make`, `cc`, `git`,
    // `python3`, `xcrun`) ask this launchd service to show the Command Line
    // Tools installer when no developer directory resolves. Closed, a stub
    // reports that no install could be requested and exits, whatever its
    // environment, and execShim says what to do. A Mac with the tools never
    // asks, so nothing that works is lost.
    `(deny mach-lookup (global-name "${COMMAND_LINE_TOOLS_INSTALLER}"))`,
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

/**
 * What starting a sandbox from this process came to: it works, or the system
 * said it cannot (no bubblewrap installed, user namespaces closed, Seatbelt
 * already applied to this process, which does not nest), or the probe gave
 * no answer (it timed out under load, or the system was out of processes).
 */
type ProbeResult = "failed" | "unavailable" | "works";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Runs a sandbox's probe. Only an answer is kept by the callers: a probe
 * that gave none is run again the next time a command needs it, since
 * keeping it would run every later command with no rules at all.
 */
function probeSandbox(
  file: string,
  args: readonly string[],
  /** What the system prints when it refuses to make the sandbox here. */
  refusals: readonly string[],
): ProbeResult {
  try {
    execFileSync(file, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: PROBE_TIMEOUT_MS,
    });
    return "works";
  } catch (error) {
    // execFileSync's error carries the spawn's fields, which its type omits.
    const failure = error as {
      code?: string;
      signal?: string | null;
      status?: number | null;
      stderr?: Buffer | string;
    };
    const stderr = String(failure.stderr ?? "");
    if (
      failure.code === "ENOENT" ||
      (typeof failure.status === "number" &&
        refusals.some((refusal) => stderr.includes(refusal)))
    ) {
      return "unavailable";
    }
    console.warn(
      `The native sandbox probe (${path.basename(file)}) gave no answer: ${
        failure.code ?? failure.signal ?? `exit ${String(failure.status)}`
      } ${stderr.trim()}`.trim(),
    );
    return "failed";
  }
}

let seatbeltProbe: ProbeResult | undefined;

/**
 * Whether a Seatbelt profile can be applied from this process: macOS, unless
 * this process is itself sandboxed (Seatbelt does not nest), which is the
 * case under some agent harnesses and in a test runner run inside one.
 */
function seatbeltState(): ProbeResult {
  if (process.platform !== "darwin") {
    return "unavailable";
  }
  if (seatbeltProbe === undefined || seatbeltProbe === "failed") {
    seatbeltProbe = probeSandbox(
      SANDBOX_EXEC,
      ["-p", "(version 1)(allow default)", "/usr/bin/true"],
      // `sandbox_apply: Operation not permitted` inside another sandbox.
      ["sandbox_apply", "Operation not permitted"],
    );
  }
  return seatbeltProbe;
}

/** Whether Seatbelt holds the native commands this process starts. */
export function seatbeltAvailable(): boolean {
  return seatbeltState() === "works";
}

/**
 * Whether native commands run under a system sandbox here, or would once a
 * probe that gave no answer gets one; false only where the system said none
 * can be made.
 */
export function nativeSandboxEnforced(): boolean {
  return (
    seatbeltState() !== "unavailable" ||
    bwrapState() !== "unavailable" ||
    mxcState() !== "unavailable"
  );
}

/**
 * Whether MXC holds the native commands this process starts: Windows, with
 * `INSTRUMENT_MXC=1` in the app's environment while it is new, the launcher
 * shipped, and the canary passed on this build of Windows. A canary that
 * gave no answer is "failed" and runs again for the next command.
 */
function mxcState(): ProbeResult {
  const exec = getWorkspaceConfig().mxcExecPath;
  if (
    process.platform !== "win32" ||
    appEnv.INSTRUMENT_MXC !== "1" ||
    !exec ||
    !existsSync(exec)
  ) {
    return "unavailable";
  }
  const verdict = mxcVerdict(exec, mxcCanaryLaunch(exec));
  return verdict.kind === "works"
    ? "works"
    : verdict.kind === "fails"
      ? "unavailable"
      : "failed";
}

/**
 * How the canary runs its program: through the same generator and launcher
 * every native command takes, so what it proves is what they get.
 */
export function mxcCanaryLaunch(exec: string): MxcLaunch {
  return (canaryReach, file, args, context) => {
    const filesystem = mxcFilesystemPolicy(canaryReach);
    return launchNative(
      {
        args: [],
        file: exec,
        mxc: {
          argv: [file, ...args],
          filesystem: context.policy?.(filesystem) ?? filesystem,
        },
      },
      context,
    );
  };
}

/**
 * Thrown in place of running a command with no sandbox when the one this
 * computer has did not start.
 */
export class NativeSandboxUnavailableError extends Error {
  constructor(file: string) {
    super(
      `${path.basename(file)} did not run: the sandbox that holds commands to the permission settings did not start, and Instrument does not run a command without it. Run the command again in a moment.`,
    );
    this.name = "NativeSandboxUnavailableError";
  }
}

/**
 * A program the app runs for itself, outside the rules, with only the
 * Command Line Tools installer closed to it and everything it starts.
 * Unwrapped where Seatbelt cannot be applied. Not for a program that
 * sandboxes itself (Chromium), since Seatbelt does not nest.
 */
export function withInstallerClosed(
  file: string,
  args: readonly string[],
): { args: string[]; file: string } {
  return seatbeltAvailable()
    ? {
        args: [
          "-p",
          `(version 1)(allow default)(deny mach-lookup (global-name "${COMMAND_LINE_TOOLS_INSTALLER}"))`,
          file,
          ...args,
        ],
        file: SANDBOX_EXEC,
      }
    : { args: [...args], file };
}

/**
 * A reach's profile, built once: a shell makes its reach once per call, so a
 * loop of native commands builds it once rather than per command.
 */
const profiles = new WeakMap<NativeReach, string>();
function profileOf(reach: NativeReach): string {
  let profile = profiles.get(reach);
  if (profile === undefined) {
    profile = seatbeltProfile(reach);
    profiles.set(reach, profile);
  }
  return profile;
}

/**
 * A profile compiled to Seatbelt's bytecode by the launcher that applies it
 * (`instrument-seatbelt compile`), base64, held by the profile's text so each
 * set of rules compiles once per launch (about 15 ms) where sandbox-exec
 * compiled it for every process. It stays in memory and reaches the launcher
 * in its arguments: a file in the temp folder is one a sandboxed program can
 * rewrite. Undefined when the launcher cannot compile it, which leaves that
 * profile on sandbox-exec.
 */
const compiled = new Map<string, string | undefined>();
/** Sets of rules kept compiled; past this, the longest unused goes. */
const COMPILED_KEPT = 32;
function compiledProfile(helper: string, profile: string): string | undefined {
  if (compiled.has(profile)) {
    // Moved to the end, as the most recently used.
    const bytecode = compiled.get(profile);
    compiled.delete(profile);
    compiled.set(profile, bytecode);
  } else {
    if (compiled.size >= COMPILED_KEPT) {
      const oldest = compiled.keys().next().value;
      if (oldest !== undefined) {
        compiled.delete(oldest);
      }
    }
    let bytecode: string | undefined;
    try {
      const bytes = execFileSync(helper, ["compile"], {
        input: profile,
        stdio: ["pipe", "pipe", "ignore"],
      });
      bytecode = bytes.length > 0 ? bytes.toString("base64") : undefined;
    } catch {
      bytecode = undefined;
    }
    compiled.set(profile, bytecode);
  }
  return compiled.get(profile);
}

/**
 * The command to spawn for a native binary, held to `reach` under Seatbelt
 * or bubblewrap. Where neither can apply, the command comes back unchanged
 * and `reach` is absent.
 */
export function wrapNativeCommand(
  file: string,
  args: readonly string[],
  /** Null runs the command unwrapped, for an app the person allowed. */
  reach: NativeReach | null | undefined = currentReach(),
): {
  args: string[];
  file: string;
  /**
   * Set when MXC holds the command on Windows: the program and its policy,
   * which `launchNative` turns into the launcher's arguments once the
   * working folder and environment are known.
   */
  mxc?: { argv: string[]; filesystem: MxcFilesystemPolicy };
  reach?: NativeReach;
} {
  // A binary that is not there is left to fail as itself, so the shim's
  // not-found diagnostic names it rather than sandbox-exec's execvp error.
  if (!reach || (path.isAbsolute(file) && !existsSync(file))) {
    return { args: [...args], file };
  }
  const seatbelt = seatbeltState();
  if (seatbelt === "works") {
    const profile = profileOf(reach);
    const helper = getWorkspaceConfig().seatbeltHelperPath;
    const bytecode = helper ? compiledProfile(helper, profile) : undefined;
    return helper && bytecode
      ? { args: ["run", bytecode, file, ...args], file: helper, reach }
      : { args: ["-p", profile, file, ...args], file: SANDBOX_EXEC, reach };
  }
  const bwrap = bwrapState();
  const mxc = mxcState();
  if (seatbelt === "failed" || bwrap === "failed" || mxc === "failed") {
    throw new NativeSandboxUnavailableError(file);
  }
  const mxcExec = getWorkspaceConfig().mxcExecPath;
  if (mxc === "works" && mxcExec) {
    // With no arguments the launcher runs nothing and says it was given no
    // request; launchNative builds the request once the working folder and
    // environment are known.
    return {
      args: [],
      file: mxcExec,
      mxc: { argv: [file, ...args], filesystem: recentMxcPolicy(reach) },
      reach,
    };
  }
  if (bwrap === "works") {
    return {
      args: [
        ...bwrapArgs(reach),
        "--",
        ...closingInheritedFds(),
        file,
        ...args,
      ],
      file: BWRAP,
      reach,
    };
  }
  return { args: [...args], file };
}

const BWRAP = "/usr/bin/bwrap";

/**
 * A reach's MXC policy, kept for a moment: building it reads every rule's
 * folder and searches the allowed ones for names that run code, about
 * 50 ms on Windows, and a pipeline's stages start together. A name made
 * since is held from the next policy built, a second later at most, as a
 * name not there yet stays open to being made under bubblewrap until the
 * next command.
 */
const mxcPolicies = new WeakMap<
  NativeReach,
  { at: number; filesystem: MxcFilesystemPolicy }
>();
const MXC_POLICY_KEPT_MS = 1000;
function recentMxcPolicy(reach: NativeReach): MxcFilesystemPolicy {
  const kept = mxcPolicies.get(reach);
  if (kept && Date.now() - kept.at < MXC_POLICY_KEPT_MS) {
    return kept.filesystem;
  }
  const filesystem = mxcFilesystemPolicy(reach);
  mxcPolicies.set(reach, { at: Date.now(), filesystem });
  return filesystem;
}

/**
 * What MXC's ProcessContainer is given for the disk: three lists of folders,
 * deny by default, where the deepest entry holding a path decides, the
 * same shape `reachOf` and the Seatbelt profile have.
 */
export interface MxcFilesystemPolicy {
  deniedPaths: string[];
  /**
   * Folders a program may look at (stat, list) without reading what is in
   * them; a deny at the same folder still refuses listing it.
   */
  enumeratePaths: string[];
  readonlyPaths: string[];
  readwritePaths: string[];
}

/**
 * MXC's filesystem lists from the rules, ordered and ranked as the Seatbelt
 * profile is: the system drive and the home folder readable and closed to
 * changes, each rule's folder opened or closed, the reach's own folders,
 * then the names that run code already in an allowed folder, read-only.
 * One entry per path, the highest rank winning, since MXC gives a path
 * named in two lists the narrower access.
 */
export function mxcFilesystemPolicy(
  reach: NativeReach,
  {
    appFolders = mxcAppFolders(),
    closed = [sandboxStateDir()],
    root = `${appEnv.SystemDrive ?? "C:"}\\`,
    walk = WALK_LIMITS,
  }: {
    /** The app's own install, which `node`, `git` and `rg` run from. */
    appFolders?: readonly string[];
    /** The app's folders no command may read or change. */
    closed?: readonly string[];
    /** The system drive's root, readable where no rule says otherwise. */
    root?: string;
    walk?: WalkLimits;
  } = {},
): MxcFilesystemPolicy {
  const { home, rules, withoutAsking } = reach.rules;
  type Access = "deny" | "read" | "write";
  const entries = new Map<
    string,
    { access: Access; path: string; rank: number }
  >();
  const fold = (target: string) =>
    process.platform === "win32" || process.platform === "darwin"
      ? target.toLowerCase()
      : target;
  const add = (target: string, access: Access, rank: number) => {
    // MXC refuses the whole request (`ERROR_PATH_NOT_FOUND`) for a Windows
    // path with no drive, which names nothing it can hold and would read the
    // working folder to resolve, and for a path whose folder is not there.
    // A path that is missing itself is held, so it cannot be made.
    if (
      (process.platform === "win32" &&
        !/^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(target)) ||
      (!existsSync(target) && !existsSync(path.dirname(target)))
    ) {
      return;
    }
    for (const spelled of spellings(target)) {
      const key = fold(spelled);
      const held = entries.get(key);
      if (!held || rank >= held.rank) {
        entries.set(key, { access, path: spelled, rank });
      }
    }
  };
  add(root, "read", -2);
  add(home, "read", -1);
  for (const rule of rules) {
    const level = levelWithoutAsking(rule.level, rule, withoutAsking);
    const access: Access =
      level === "allow" ? "write" : level === "readOnly" ? "read" : "deny";
    for (const target of rule.dotEntries
      ? dotEntriesIn(rule.path)
      : [rule.path]) {
      add(target, access, ruleRank(rule));
    }
  }
  for (const folder of [...appFolders, ...reach.readOnly]) {
    add(folder, "read", 3);
  }
  for (const folder of reach.readWrite) {
    // The app's own folders are made before they are granted, as bubblewrap
    // makes them, so a first run can write one the app makes later.
    try {
      mkdirSync(folder, { recursive: true });
    } catch {
      // Left as it is, and granted if its folder is there.
    }
    add(folder, "write", 3);
  }
  // MXC has no patterns, so the names that run code already in an allowed
  // folder are found as bubblewrap finds them and closed to changes by name.
  const own = reach.readWrite.map(resolveReal);
  const stops = new Set([
    ...own,
    ...rules.flatMap((rule) =>
      rule.dotEntries ? [] : [resolveReal(rule.path)],
    ),
  ]);
  for (const rule of rules) {
    if (
      levelWithoutAsking(rule.level, rule, withoutAsking) !== "allow" ||
      rule.source === "system"
    ) {
      continue;
    }
    const searched = resolveReal(rule.path);
    if (own.some((folder) => hostPathWithin(folder, searched) !== null)) {
      continue;
    }
    for (const { kind, path: named } of namesThatRunCode(searched, {
      dotEntriesOnly: rule.dotEntries ?? false,
      limits: walk,
      stops,
    })) {
      if (kind === "name") {
        add(named, "read", 4);
      } else if (kind === "repo") {
        add(path.join(named, "hooks"), "read", 4);
      }
    }
  }
  for (const folder of closed) {
    add(folder, "deny", 5);
  }
  /** What the deepest entry at or above `folder` gives it; none is closed. */
  const accessAt = (folder: string): Access => {
    for (let at = folder; ; at = path.dirname(at)) {
      const held = entries.get(fold(at));
      if (held) {
        return held.access;
      }
      if (at === path.dirname(at)) {
        return "deny";
      }
    }
  };
  // A path that is not there matters only where something could make it,
  // in a folder that can be changed; elsewhere its entry only slows every
  // start (a third of a millisecond each), and most rules name places that
  // exist on another platform. The app's own entries stay whatever is there.
  for (const [key, entry] of entries) {
    if (
      entry.rank < 3 &&
      !existsSync(entry.path) &&
      accessAt(path.dirname(entry.path)) !== "write"
    ) {
      entries.delete(key);
    }
  }
  const listed = (access: Access) =>
    [...entries.values()]
      .filter((entry) => entry.access === access)
      .map((entry) => entry.path)
      .toSorted();
  // A program opening a file in an open folder looks at each folder above
  // it on the way (Node's realpath lstats every one), so a closed folder on
  // that way answers what it is, as the Seatbelt profile's metadata reads
  // do; its deny still refuses listing it and reading anything in it. Only
  // a closed one: MXC gives a folder named for looking at that access and
  // no more, so naming a readable one would take its reads away.
  const closedAt = (folder: string) => accessAt(folder) === "deny";
  const above = new Map<string, string>();
  for (const entry of entries.values()) {
    if (entry.access === "deny") {
      continue;
    }
    for (
      let folder = path.dirname(entry.path);
      folder !== path.dirname(folder);
      folder = path.dirname(folder)
    ) {
      if (closedAt(folder)) {
        above.set(fold(folder), folder);
      }
    }
  }
  return {
    deniedPaths: listed("deny"),
    enumeratePaths: [...above.values()].toSorted(),
    readonlyPaths: listed("read"),
    readwritePaths: listed("write"),
  };
}

/**
 * The folders the app runs its own programs from: Electron's (which `node`
 * is) and its resources (git, rg, uutils, uv, ffmpeg). On Windows both sit
 * under `AppData`, a place that asks first.
 */
function mxcAppFolders(): string[] {
  // `resourcesPath` is Electron's; Node has none.
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  return [path.dirname(process.execPath), ...(resources ? [resources] : [])];
}

/**
 * One argument as a Windows program's C runtime splits its command line
 * back into arguments, the way libuv quotes it for `CreateProcess`.
 */
function quoteWindowsArg(arg: string): string {
  if (arg === "") {
    return '""';
  }
  if (!/[\s"]/.test(arg)) {
    return arg;
  }
  let quoted = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    quoted +=
      char === '"'
        ? `${"\\".repeat(backslashes * 2 + 1)}"`
        : `${"\\".repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

/**
 * The command line a program gets on Windows, quoted as Node would quote it
 * or, with `verbatim` (a `cmd.exe` line), joined as given.
 */
export function windowsCommandLine(
  argv: readonly string[],
  verbatim = false,
): string {
  return argv.map((arg) => (verbatim ? arg : quoteWindowsArg(arg))).join(" ");
}

/**
 * The MXC request (policy 1.0.0) that runs `commandLine` held to `filesystem`.
 * Tier 1 or nothing: no fallback that would add ACEs to the person's
 * folders. The program gets exactly `env`, since the container does not
 * inherit the launcher's, and UI stays on, since anything importing USER32
 * (node, Electron as node) fails to start without it; the clipboard and
 * input injection stay closed by MXC's defaults. The network is open, as it
 * is to native commands everywhere.
 */
export function mxcRequest({
  commandLine,
  cwd,
  env,
  filesystem,
}: {
  commandLine: string;
  /** Absent, the program starts in its own folder, as MXC does. */
  cwd?: string;
  env: Record<string, string | undefined>;
  filesystem: MxcFilesystemPolicy;
}) {
  const { enumeratePaths, ...lists } = filesystem;
  return {
    version: "1.0.0",
    containment: "processcontainer",
    fallback: { allowDaclMutation: false },
    filesystem: lists,
    ...(enumeratePaths.length > 0
      ? { processContainer: { filesystem: { enumeratePaths } } }
      : {}),
    network: {
      egress: { default: "allow" },
      ingress: { default: "allow", hostLoopback: "allow" },
    },
    process: {
      commandLine,
      ...(cwd === undefined ? {} : { cwd }),
      env: Object.entries(env).flatMap(([name, value]) =>
        value === undefined ? [] : [`${name}=${value}`],
      ),
      timeout: 0,
    },
    ui: { disable: false },
  };
}

/** Past this, a request goes in a file rather than on the command line. */
const MXC_INLINE_LIMIT = 30_000;

/**
 * The launcher and its arguments for a command `wrapNativeCommand` held
 * under MXC, now that its working folder and environment are known; any
 * other command comes back as it was wrapped. Every caller that spawns
 * what `wrapNativeCommand` returned goes through this.
 */
export function launchNative(
  spawned: ReturnType<typeof wrapNativeCommand>,
  context: {
    cwd?: string;
    env: Record<string, string | undefined>;
    windowsVerbatimArguments?: boolean;
  },
): { args: string[]; file: string } {
  const { mxc } = spawned;
  if (!mxc) {
    return { args: spawned.args, file: spawned.file };
  }
  const request = JSON.stringify(
    mxcRequest({
      commandLine: windowsCommandLine(
        mxc.argv,
        context.windowsVerbatimArguments,
      ),
      cwd: context.cwd,
      env: context.env,
      filesystem: mxc.filesystem,
    }),
  );
  const inline = Buffer.from(request).toString("base64");
  if (inline.length <= MXC_INLINE_LIMIT) {
    return { args: ["--config-base64", inline], file: spawned.file };
  }
  // In the sandbox's own folder, which every request closes, named by its
  // contents so a request is written once however often it runs.
  const file = path.join(
    sandboxStateDir(),
    "mxc-requests",
    `${createHash("sha256").update(request).digest("hex")}.json`,
  );
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, request);
  }
  return { args: ["--config", file], file: spawned.file };
}

/**
 * A step inside the sandbox that closes every file descriptor the command
 * would inherit but its standard streams and Node's IPC channel, then runs
 * it. On Linux a spawned program inherits whatever the app holds open
 * without close-on-exec (Chromium's databases, its IPC sockets, the debug
 * port), and an open descriptor reaches past every folder bubblewrap
 * closes. Nothing may run before the descriptors are closed: `-p` keeps
 * bash from reading BASH_ENV or functions from the environment, and
 * `--norc` from sourcing ~/.bashrc, which bash does for `-c` when stdin is
 * a socket and SHLVL is unset, as it is under the app. macOS
 * needs none: libuv spawns there with every descriptor closed on exec.
 */
function closingInheritedFds(): string[] {
  return existsSync("/bin/bash")
    ? [
        "/bin/bash",
        "--norc",
        "-p",
        "-c",
        'for f in /proc/self/fd/*; do f=${f##*/}; case $f in 0|1|2|"$NODE_CHANNEL_FD") ;; *) eval "exec $f>&-" 2>/dev/null ;; esac; done; exec "$@"',
        "bash",
      ]
    : [];
}

let bwrapProbe: ProbeResult | undefined;

/**
 * Whether bubblewrap can make a sandbox from this process: Linux with bwrap
 * installed and user namespaces open to it. Ubuntu closes them to
 * unprivileged programs, and the app's own AppArmor profile, which the
 * `.deb` installs, opens them for the app and what it starts.
 */
function bwrapState(): ProbeResult {
  if (process.platform !== "linux") {
    return "unavailable";
  }
  if (bwrapProbe === undefined || bwrapProbe === "failed") {
    bwrapProbe = probeSandbox(
      BWRAP,
      ["--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev", "/usr/bin/true"],
      // User namespaces closed: `No permissions to create new namespace`,
      // `setting up uid map: Permission denied`, `Creating new namespace
      // failed: Operation not permitted`.
      ["No permissions", "Permission denied", "Operation not permitted"],
    );
  }
  return bwrapProbe;
}

/** Whether bubblewrap holds the native commands this process starts. */
export function bwrapAvailable(): boolean {
  return bwrapState() === "works";
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
export function bwrapArgs(
  reach: NativeReach,
  walk: WalkLimits = WALK_LIMITS,
  session: {
    /** The ssh-agent's socket the app was started with, if any. */
    agentSocket?: string;
    /** The login session's runtime folder, `/run/user/<uid>`. */
    runtimeDir?: string;
  } = {
    agentSocket: appEnv.SSH_AUTH_SOCK,
    runtimeDir:
      appEnv.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`,
  },
): string[] {
  const { home, rules, withoutAsking } = reach.rules;
  /** "empty" is a read-only empty folder made where nothing is yet. */
  type Access = "empty" | "none" | "read" | "write";
  const entries: {
    access: Access;
    depth: number;
    path: string;
    rank: number;
  }[] = [];
  const added = new Set<string>();
  const add = (target: string, access: Access, rank: number) => {
    const key = `${access}:${target}`;
    if (!added.has(key)) {
      added.add(key);
      entries.push({ access, depth: depthOf(target), path: target, rank });
    }
  };
  add(home, "read", -1);
  // The folder holding what stands in for a closed file, read-only whatever
  // opens a folder above it, so nothing can be put in its place.
  const standIn = unreadableFile();
  add(path.dirname(standIn), "read", 3);
  for (const rule of rules) {
    const level = levelWithoutAsking(rule.level, rule, withoutAsking);
    const access =
      level === "allow" ? "write" : level === "readOnly" ? "read" : "none";
    const targets = rule.dotEntries ? dotEntriesIn(rule.path) : [rule.path];
    for (const target of targets) {
      add(target, access, ruleRank(rule));
    }
  }
  const caches = toolCaches();
  for (const opened of [...caches, ...reach.readWrite]) {
    add(opened, "write", 3);
  }
  for (const opened of reach.readOnly) {
    add(opened, "read", 3);
  }
  // bubblewrap has no pattern for a name that runs code when its folder is
  // used, so each allowed folder of the person's is searched for the ones
  // already there and they are bound read-only by name, as is a repository's
  // hooks folder. A repository's .git, and every folder between a name and
  // the allowed folder, is bound onto itself: a mount point cannot be renamed
  // or removed, so the name cannot be carried out from under its bind and
  // made again unbound, or the folder holding it swapped for a copy.
  const own = [...caches, ...reach.readWrite].map(resolveReal);
  const isOwn = (target: string) =>
    own.some((folder) => hostPathWithin(folder, target) !== null);
  const stops = new Set([
    ...own,
    ...rules.flatMap((rule) =>
      rule.dotEntries ? [] : [resolveReal(rule.path)],
    ),
  ]);
  const guarded = new Set<string>();
  for (const rule of rules) {
    if (
      levelWithoutAsking(rule.level, rule, withoutAsking) !== "allow" ||
      rule.source === "system"
    ) {
      continue;
    }
    const root = resolveReal(rule.path);
    const dotEntriesOnly = rule.dotEntries ?? false;
    const searched = `${dotEntriesOnly ? "." : ""}${root}`;
    if (isOwn(root) || guarded.has(searched)) {
      continue;
    }
    guarded.add(searched);
    const found = namesThatRunCode(root, {
      dotEntriesOnly,
      limits: walk,
      stops,
    });
    for (const { kind, path: named } of found) {
      for (
        let folder = path.dirname(named);
        folder !== root && folder !== path.dirname(folder);
        folder = path.dirname(folder)
      ) {
        add(folder, "write", 4);
      }
      if (kind === "name") {
        add(named, "read", 4);
        continue;
      }
      add(named, "write", 4);
      const hooks = path.join(named, "hooks");
      if (existsSync(hooks)) {
        add(hooks, "read", 4);
      } else if (kind === "repo" && canWrite(named)) {
        // A repository with no hooks folder gets an empty one nothing can
        // write, so none can be made; bubblewrap leaves the empty folder
        // behind, as `git init` would have made it. One whose .git this
        // account cannot write is left as it is, since bubblewrap could not
        // make the folder to mount on and the command would not start.
        add(hooks, "empty", 4);
      }
    }
  }
  const args = [
    "--ro-bind",
    "/",
    "/",
    // A fresh /dev with the nodes a program uses (null, zero, random, tty,
    // a pty, shm), not the host's disks, input devices and GPU.
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    // Its own process namespace, so a program the command starts and leaves
    // behind dies with it when the app quits, rather than being handed to
    // the session's init still holding what it inherited.
    "--unshare-pid",
    // Its own user and IPC namespaces with every capability dropped, so a
    // setuid helper or a shared-memory segment of the person's other
    // programs is no way out.
    "--unshare-user",
    "--unshare-ipc",
    "--cap-drop",
    "ALL",
    "--die-with-parent",
    // Its own session, so a command cannot push keystrokes into the
    // terminal the app was started from (TIOCSTI).
    "--new-session",
  ];
  // The login session's runtime folder holds sockets that act outside the
  // sandbox: the session bus, through which `systemd-run --user` starts a
  // command outside it, and the ssh and gpg agents, which sign with keys
  // the rules may keep closed. An empty folder stands in for it, and the
  // ssh-agent's socket is bound back once the rules reach ~/.ssh, as the
  // Seatbelt profile opens it. A socket in the abstract namespace has no
  // path to cover; the session bus is found by its path.
  const { agentSocket, runtimeDir } = session;
  const emptied =
    runtimeDir && path.isAbsolute(runtimeDir) && existsSync(runtimeDir)
      ? resolveReal(runtimeDir)
      : undefined;
  if (emptied) {
    args.push("--tmpfs", emptied);
  }
  const sessionSockets: string[] = [];
  if (agentSocket && path.isAbsolute(agentSocket) && existsSync(agentSocket)) {
    const socket = resolveReal(agentSocket);
    if (reachesSshKeys(reach)) {
      sessionSockets.push("--bind", socket, socket);
    } else if (!emptied || hostPathWithin(emptied, socket) === null) {
      // A socket elsewhere (`/tmp/ssh-…/agent.<pid>`) is covered by the
      // file that stands in for a closed one.
      sessionSockets.push("--ro-bind", standIn, socket);
    }
  }
  // Of the entries for one path, the last mounts over the others, so it is
  // the only one kept: a closed folder's read-only remount, which comes last
  // of all, would otherwise land on the allow bound over it.
  const sorted = entries.toSorted(
    (a, b) => a.depth - b.depth || a.rank - b.rank,
  );
  const lastFor = new Map(sorted.map((entry) => [entry.path, entry]));
  const ordered = sorted.filter((entry) => lastFor.get(entry.path) === entry);
  // A tool's cache or the chat's own folder that is not there yet is made
  // before it is bound, so a first run on a new computer can write it: an
  // unbound folder would stay read-only with the home folder around it. So
  // is a folder the person allowed by name before it was made (a card for
  // the repository `git init` was about to make), where the folder holding
  // it is there. So is a read-only folder inside one of ours, which would
  // otherwise be left as writable as the folder around it.
  const ours = new Set([...caches, ...reach.readWrite]);
  for (const closed of reach.readOnly) {
    if ([...ours].some((folder) => hostPathWithin(folder, closed) !== null)) {
      ours.add(closed);
    }
  }
  const allowedByName = new Set(
    rules
      .filter(
        (rule) =>
          rule.level === "allow" &&
          !rule.dotEntries &&
          (rule.source === "grant" || rule.source === "folder"),
      )
      .map((rule) => rule.path),
  );
  const remountLater: string[] = [];
  for (const entry of ordered) {
    const real = resolveReal(entry.path);
    if (entry.access === "empty") {
      args.push("--tmpfs", real, "--remount-ro", real);
      continue;
    }
    if (
      !existsSync(real) &&
      (ours.has(entry.path) ||
        (allowedByName.has(entry.path) && existsSync(path.dirname(real))))
    ) {
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
      // Read-only too, so nothing can be made in it to stand in for what it
      // closes and its mode cannot be given back; one a folder opens inside
      // is made read-only after every bind, since bubblewrap makes the
      // folder to bind it to, and a remount leaves the binds inside it be.
      args.push("--perms", opensInside ? "0111" : "0000", "--tmpfs", real);
      if (opensInside) {
        remountLater.push("--remount-ro", real);
      } else {
        args.push("--remount-ro", real);
      }
    } else {
      // A file nobody may open, in place of the closed one, so reading it
      // is refused rather than empty.
      args.push("--ro-bind", standIn, real);
    }
  }
  return [...args, ...sessionSockets, ...remountLater];
}

/**
 * An empty file with no permissions, bound over a closed file. It lives in
 * the app's own data folder, which no sandboxed command may change, and is
 * looked at without following a link: anything there that is not that
 * file is removed and the file made anew, never changed in place, so a
 * link planted there can lead nowhere.
 */
function unreadableFile(): string {
  const file = path.join(
    path.dirname(getWorkspaceConfig().uvDataDir),
    "sandbox",
    "closed-file",
  );
  let found: Stats | undefined;
  try {
    found = lstatSync(file);
  } catch {
    // Not made yet.
  }
  if (
    found &&
    !(found.isFile() && found.size === 0 && (found.mode & 0o777) === 0)
  ) {
    rmSync(file, { force: true, recursive: true });
    found = undefined;
  }
  if (!found) {
    mkdirSync(path.dirname(file), { recursive: true });
    // `wx` fails rather than follow anything made there meanwhile.
    writeFileSync(file, "", { flag: "wx", mode: 0o000 });
  }
  return file;
}

/** How far the search for names that run code goes into one folder. */
export interface WalkLimits {
  /** How many folders down a name may sit: 1 is the folder's own. */
  depth: number;
  /** How many entries one folder's search lists before it stops. */
  entries: number;
}

/**
 * Three folders down finds a repository in a folder of projects in an
 * allowed folder (`Documents/code/app/.git`). The entry cap keeps one command's start bounded however big
 * the folder is; the search goes shallow first, so what it leaves out is
 * the deepest.
 */
const WALK_LIMITS: WalkLimits = { depth: 3, entries: 10_000 };

/** Folders too big to search that no one keeps a repository in. */
const UNSEARCHED = new Set(["node_modules"]);

/**
 * The names that run code already in `root`, and the repositories, each
 * `.git` file or folder, found breadth first down to `limits.depth` and no
 * further than `limits.entries` listed. Symlinks are not followed, and the
 * search stops at each of `stops`, a folder some other rule decides.
 */
function namesThatRunCode(
  root: string,
  {
    dotEntriesOnly,
    limits,
    stops,
  }: {
    /** Only the root's hidden entries, for the rule over a home's. */
    dotEntriesOnly: boolean;
    limits: WalkLimits;
    stops: ReadonlySet<string>;
  },
): { kind: "gitFile" | "name" | "repo"; path: string }[] {
  const found: { kind: "gitFile" | "name" | "repo"; path: string }[] = [];
  const queue = [{ depth: 1, folder: root }];
  let listed = 0;
  for (const next of queue) {
    let entries: Dirent[];
    try {
      entries = readdirSync(next.folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (listed++ >= limits.entries) {
        return found;
      }
      if (dotEntriesOnly && next.depth === 1 && !entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(next.folder, entry.name);
      if (stops.has(entryPath)) {
        continue;
      }
      if (entry.name === ".git") {
        found.push({
          kind: entry.isDirectory() ? "repo" : "gitFile",
          path: entryPath,
        });
        continue;
      }
      let named = false;
      for (const name of DANGEROUS_NAMES) {
        const [first, ...rest] = name.split("/");
        if (first !== entry.name) {
          continue;
        }
        if (rest.length === 0) {
          named = true;
          found.push({ kind: "name", path: entryPath });
        } else if (existsSync(path.join(next.folder, name))) {
          found.push({ kind: "name", path: path.join(next.folder, name) });
        }
      }
      if (
        !named &&
        entry.isDirectory() &&
        next.depth < limits.depth &&
        !UNSEARCHED.has(entry.name)
      ) {
        queue.push({ depth: next.depth + 1, folder: entryPath });
      }
    }
  }
  return found;
}

function canWrite(target: string): boolean {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
  return heldNativeReach() ?? appNativeReach();
}

/**
 * The reach of a native command the app starts on its own, outside any
 * chat: it may change nothing on disk except `readWrite`. Undefined when
 * native commands run unsandboxed.
 */
export function appNativeReach(
  readWrite: readonly string[] = [],
): NativeReach | undefined {
  if (!getWorkspaceConfig().nativeSandbox) {
    return undefined;
  }
  const home = os.homedir();
  return {
    readOnly: [],
    readWrite,
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

/** What separates a path's parts in a program's output here. */
const SEPARATOR = process.platform === "win32" ? /[\\/]/ : /\//;

const REFUSALS = [
  "not permitted",
  "Permission denied",
  // Windows' own wording, as a Rust or C program prints it.
  "Access is denied",
  "No such file",
  "Read-only file system",
];

/**
 * The paths a line refusing a path names, the likeliest first. A path in
 * quotes is whole, spaces and apostrophes included (`'Acme Corp/a.csv'`,
 * `"Bob's Files"`, GNU's `‘/home/x’`), and the last one quoted is the one
 * refused. Unquoted, the path runs from the first word with a slash up to
 * the `: <refusal>` that ends the line (`cp: /Users/s/Acme Corp/a.csv:
 * Operation not permitted`), past what a shell names first
 * (`/bin/sh: 1: cannot create <path>`). Failing both, each word with a
 * slash, last first.
 */
function pathsNamedIn(line: string, refusal: string): string[] {
  const quoted = [
    ...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|‘([^’]*)’|“([^”]*)”/g),
  ]
    .map((match) => match.slice(1).find((group) => group !== undefined) ?? "")
    .filter((span) => SEPARATOR.test(span));
  if (quoted.length > 0) {
    return quoted.toReversed();
  }
  const end = line.lastIndexOf(": ", line.indexOf(refusal));
  if (end !== -1) {
    const words = (line.slice(0, end).split(": ").at(-1) ?? "").split(" ");
    const first = words.findIndex((word) => SEPARATOR.test(word));
    if (first !== -1) {
      return [words.slice(first).join(" ")];
    }
  }
  return [
    ...line.matchAll(/(?<=^|[\s:'"`(=[‘“])[^\s:'"`‘’“”]*\/[^\s:'"`‘’“”]*/g),
    // A drive-letter path, whose colon the pattern above stops at.
    ...(process.platform === "win32"
      ? line.matchAll(/(?<=^|[\s'"`(=[‘“])[A-Za-z]:\\[^\s:'"`‘’“”]*/g)
      : []),
  ]
    .map((match) => match[0])
    .toReversed();
}

/** A path the rules kept a native command from, and how it was used. */
interface Refused {
  hostPath: string;
  /** Whether the output says the path was a folder being made. */
  isDirectory: boolean;
  op: "read" | "write";
  reach: Reach;
  rules: Rules;
}

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
): undefined | Refused {
  for (const line of output.split("\n")) {
    // Seatbelt refuses with "Operation not permitted"; bubblewrap leaves a
    // closed folder empty and a home folder read-only, so the same refusal
    // reads as a missing file or a read-only disk there.
    const refusal = REFUSALS.find((each) => line.includes(each));
    if (refusal === undefined) {
      continue;
    }
    // A program names a path the way it was given, so `closed/a.txt` is
    // read against the cwd.
    for (const named of pathsNamedIn(line, refusal)) {
      if (!path.isAbsolute(named) && cwd === undefined) {
        continue;
      }
      const hostPath = path.resolve(cwd ?? "/", named);
      // A missing file can only be a closed read; anything else may have
      // been a change.
      const op = line.includes("No such file") ? "read" : "write";
      const decided = reachOf(reach.rules, hostPath, op);
      if (decided.level !== "allow") {
        return {
          hostPath,
          // `mkdir: cannot create directory`, git's `cannot mkdir`, Node's
          // `EROFS: ..., mkdir`.
          isDirectory: /\bmkdir\b|create directory/.test(line),
          op,
          reach: decided,
          rules: reach.rules,
        };
      }
    }
  }
  return undefined;
}

/** What the agent reads when the rules stopped a native command. */
export function refusalNote(refused: Refused): string | undefined {
  return ruleRefusal({
    afterAsk: "Run the command again once they allow it.",
    hostPath: refused.hostPath,
    isDirectory: refused.isDirectory,
    op: refused.op,
    reach: refused.reach,
    rules: refused.rules,
    // Native commands are wrapped on macOS and Linux, where a path in the
    // home folder is said from `~`.
    spell: (hostPath) => {
      const { home } = refused.rules;
      return hostPath === home
        ? "~"
        : hostPath.startsWith(`${home}/`)
          ? `~/${hostPath.slice(home.length + 1)}`
          : hostPath;
    },
  });
}
