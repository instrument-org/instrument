import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hostPathWithin } from "../host-path";
import { levelAllowingEveryFolder, ruleRank } from "../permissions/rules";
import { getWorkspaceConfig } from "../workspace-config";
import {
  type Disk,
  type DiskProof,
  dotEntriesIn,
  liveDisk,
  proofHolds,
  recordingDisk,
} from "./disk";
import { appEnv, spellings } from "./host";
import { type MxcLaunch, mxcVerdict, sandboxStateDir } from "./mxc-canary";
import { type ProbeResult } from "./probe";
import { type NativeReach } from "./reach";

/**
 * Whether MXC holds the native commands this process starts: Windows, the
 * launcher shipped, and the canary passed on this build of Windows, unless
 * `INSTRUMENT_MXC=0` in the app's environment turns it off. A canary that
 * gave no answer is "failed" and runs again for the next command.
 */
export function mxcState(): ProbeResult {
  const exec = getWorkspaceConfig().mxcExecPath;
  if (
    process.platform !== "win32" ||
    appEnv.INSTRUMENT_MXC === "0" ||
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
    return mxcLaunch(
      {
        argv: [file, ...args],
        file: exec,
        filesystem: context.policy?.(filesystem) ?? filesystem,
      },
      context,
    );
  };
}

/** What a policy is built from besides the reach. */
interface PolicyInputs {
  /** The app's own install, which `node`, `git` and `rg` run from. */
  appFolders: readonly string[];
  /** The app's folders no command may read or change. */
  closed: readonly string[];
  /** The system drive's root, readable where no rule says otherwise. */
  root: string;
}

function policyInputs(given: Partial<PolicyInputs>): PolicyInputs {
  return {
    appFolders: given.appFolders ?? mxcAppFolders(),
    closed: given.closed ?? [sandboxStateDir()],
    root: given.root ?? `${appEnv.SystemDrive ?? "C:"}\\`,
  };
}

/**
 * Policies built, by the reach and inputs they were built from, each with
 * the proof that the disk still answers as it did. Building one reads every
 * rule's folder and lists the home folder's hidden entries, where checking
 * the proof stats the paths those answers came from. A hidden folder made
 * in the home folder changes the listing, so the next command builds a
 * policy that holds it by the rule over hidden entries.
 */
const policies = new Map<
  string,
  { filesystem: MxcFilesystemPolicy; proof: DiskProof }
>();
/** Policies kept; past this, the longest unused goes. */
const POLICIES_KEPT = 32;

/** The reach's MXC policy: the one built before, while its proof holds. */
export function mxcPolicyFor(
  reach: NativeReach,
  {
    disk = liveDisk,
    now = Date.now(),
    ...given
  }: Partial<PolicyInputs> & {
    disk?: Disk;
    /** When the build starts, which every stamp must be settled before. */
    now?: number;
  } = {},
): MxcFilesystemPolicy {
  const inputs = policyInputs(given);
  const { home, rules, dangerouslyAllowEveryFolder } = reach.rules;
  const key = JSON.stringify([
    reach.readOnly,
    reach.readWrite,
    home,
    rules,
    dangerouslyAllowEveryFolder,
    inputs,
  ]);
  const kept = policies.get(key);
  policies.delete(key);
  if (kept && proofHolds(kept.proof)) {
    // Back at the end, as the most recently used.
    policies.set(key, kept);
    return kept.filesystem;
  }
  const recording = recordingDisk(disk, now);
  const filesystem = mxcFilesystemPolicy(reach, {
    ...inputs,
    disk: recording.disk,
  });
  const proof = recording.proof();
  if (proof) {
    const oldest = policies.keys().next();
    if (policies.size >= POLICIES_KEPT && !oldest.done) {
      policies.delete(oldest.value);
    }
    policies.set(key, { filesystem, proof });
  }
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
 * changes, each rule's folder opened or closed, then the reach's own
 * folders. One entry per path, the highest rank winning, since MXC gives a path
 * named in two lists the narrower access.
 */
export function mxcFilesystemPolicy(
  reach: NativeReach,
  { disk = liveDisk, ...given }: Partial<PolicyInputs> & { disk?: Disk } = {},
): MxcFilesystemPolicy {
  const { appFolders, closed, root } = policyInputs(given);
  const { home, rules, dangerouslyAllowEveryFolder } = reach.rules;
  // The app's own folders are made before they are granted, as bubblewrap
  // makes them, so a first run can write one the app makes later; and
  // before anything is read, so the policy is built from the disk as it is
  // after. One that cannot be made is granted if its folder is there.
  for (const folder of reach.readWrite) {
    disk.makeFolder(folder);
  }
  /**
   * `list` is a closed folder with an open one below it, which a program may
   * list but not read in (`enumeratePaths`).
   */
  type Access = "deny" | "list" | "read" | "write";
  const entries = new Map<
    string,
    {
      access: Access;
      /** Set by a rule closing the app's own data. */
      appData?: true;
      /**
       * Set by a rule closing its folder outright (Not allowed, or the
       * app's own data), whose names stay closed where it is listed.
       */
      hidden?: true;
      path: string;
      rank: number;
    }
  >();
  const fold = (target: string) =>
    process.platform === "win32" || process.platform === "darwin"
      ? target.toLowerCase()
      : target;
  const add = (
    target: string,
    access: Access,
    rank: number,
    appData?: true,
    hidden?: true,
  ) => {
    // MXC refuses the whole request (`ERROR_PATH_NOT_FOUND`) for a Windows
    // path with no drive, which names nothing it can hold and would read the
    // working folder to resolve, and for a path whose folder is not there.
    // A path that is missing itself is held, so it cannot be made.
    if (
      (process.platform === "win32" &&
        !/^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(target)) ||
      (!disk.exists(target) && !disk.exists(path.dirname(target)))
    ) {
      return;
    }
    for (const spelled of spellings(target, disk.real)) {
      const key = fold(spelled);
      const held = entries.get(key);
      if (!held || rank >= held.rank) {
        entries.set(key, {
          access,
          ...(appData && { appData }),
          ...((appData ?? hidden) && { hidden: true }),
          path: spelled,
          rank,
        });
      }
    }
  };
  add(root, "read", -2);
  add(home, "read", -1);
  for (const rule of rules) {
    const level = levelAllowingEveryFolder(
      rule.level,
      rule,
      dangerouslyAllowEveryFolder,
    );
    // A listed place that asks first is listed whatever opens below it.
    const access: Access =
      level === "allow"
        ? "write"
        : level === "readOnly"
          ? "read"
          : rule.listed && level === "ask"
            ? "list"
            : "deny";
    for (const target of rule.dotEntries
      ? dotEntriesIn(rule.path, disk)
      : [rule.path]) {
      add(
        target,
        access,
        ruleRank(rule),
        rule.appData && access === "deny" ? true : undefined,
        level === "never" ? true : undefined,
      );
    }
  }
  for (const folder of [...appFolders, ...reach.readOnly]) {
    add(folder, "read", 3);
  }
  for (const folder of reach.readWrite) {
    add(folder, "write", 3);
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
      !disk.exists(entry.path) &&
      accessAt(path.dirname(entry.path)) !== "write"
    ) {
      entries.delete(key);
    }
  }
  const opened = [...entries.values()].filter(
    (entry) => entry.access === "read" || entry.access === "write",
  );
  /** Whether an open entry is inside `folder`, below it. */
  const opensBelow = (folder: string) =>
    opened.some(
      (entry) =>
        fold(entry.path) !== fold(folder) &&
        hostPathWithin(folder, entry.path) !== null,
    );
  /** The reach's own folders, which a program works in, below `folder`. */
  const working = reach.readWrite.flatMap((folder) => [
    folder,
    disk.real(folder),
  ]);
  const worksBelow = (folder: string) =>
    working.some(
      (inside) =>
        fold(inside) !== fold(folder) &&
        hostPathWithin(folder, inside) !== null,
    );
  // A folder denied by name breaks a program working anywhere below it:
  // git's look up the folders for a repository fails on the first it cannot
  // stat ("failed to stat '...': Permission denied"), and Windows PowerShell
  // 5.1 starts in `C:\` instead. So a closed folder with an open one below
  // it is listed rather than denied: its names and theirs all the way down
  // can be listed and stat'd, until a folder denied by name, and nothing in
  // it read or changed. A folder of the app's own data is listed only on
  // the way to one of the reach's own folders, where programs work (the
  // chat's work folder, the runtime's caches); what else opens in it (the
  // attachments a chat reads) is reached through it denied by name, which
  // still answers `lstat`, so none of its names show.
  for (const entry of entries.values()) {
    if (
      entry.access === "deny" &&
      (entry.appData ? worksBelow(entry.path) : opensBelow(entry.path))
    ) {
      entry.access = "list";
    }
  }
  /** The nearest entry at or above `folder`, if any. */
  const nearestListed = (folder: string) => {
    for (let at = folder; ; at = path.dirname(at)) {
      const held = entries.get(fold(at));
      if (held || at === path.dirname(at)) {
        return held;
      }
    }
  };
  // The app's own data listed that way would show every name in it: each
  // workspace's keys, profiles and records. So in a listed folder of the
  // app's, and in every folder below it on the way to an open one, each
  // folder off that way is denied by name, closing the names in it too; and
  // the same in a folder the person set to Not allowed (App files, around
  // the app's own programs in `AppData\Local\Programs`). A folder of the
  // person's that asks first and is listed shows its names, which is what
  // asking first about it costs.
  const offTheWay = (folder: string) => {
    for (const child of disk.list(folder) ?? []) {
      if (!child.isDirectory()) {
        continue;
      }
      const inside = path.join(folder, child.name);
      if (entries.has(fold(inside))) {
        continue;
      }
      if (opensBelow(inside)) {
        offTheWay(inside);
      } else {
        add(inside, "deny", 5);
      }
    }
  };
  // Taken before any is denied, since that adds to the entries.
  const listedHidden = [...entries.values()].filter(
    (entry) => entry.access === "list" && entry.hidden,
  );
  for (const entry of listedHidden) {
    offTheWay(entry.path);
  }
  // A denied folder whose nearest listed folder above is denied too adds
  // nothing to what the deny above closes, and MXC refuses it `lstat` even
  // when it is named to look at, so a program cannot reach what is open
  // below it. Left out, it is closed by the deny above like any folder on
  // the way. Under a listed folder it stays, so its names do not show.
  for (const [key, entry] of entries) {
    if (
      entry.access === "deny" &&
      nearestListed(path.dirname(entry.path))?.access === "deny"
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
  // it on the way (Node's realpath lstats every one), so each closed folder
  // on that way is listed too. Only a closed one: MXC gives a folder named
  // for looking at that access and no more, so naming a readable one would
  // take its reads away.
  const closedAt = (folder: string) => {
    const access = accessAt(folder);
    return (
      (access === "deny" || access === "list") &&
      entries.get(fold(folder)) === undefined
    );
  };
  const above = new Map<string, string>();
  for (const entry of opened) {
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
  for (const folder of listed("list")) {
    above.set(fold(folder), folder);
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

/** A command `wrapNativeCommand` held under MXC, before its request is made. */
export interface MxcCommand {
  /** The program and its arguments, run inside the container. */
  argv: string[];
  /** MXC's launcher. */
  file: string;
  filesystem: MxcFilesystemPolicy;
}

/**
 * `argv` started through uutils' `env`, which sets TEMP and TMP back to the
 * values in `env` inside the container. Windows starts a container's first
 * program with TEMP, TMP and LOCALAPPDATA moved into a profile made for that
 * launch and removed when it ends, so a file a program leaves in its temp
 * folder would be gone, and would never be in the shell's `/tmp`. A program
 * `env` starts keeps the environment it is given, and the temp folder it
 * names is one the policy already opens, so nothing is reached that was not
 * before. Left as it is: a `cmd.exe` line, which `env` would requote; a batch
 * file, whose arguments Rust's `Command` escapes its own way; and a run with
 * no uutils or no temp folder to give.
 */
function withTempRestored(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  verbatim = false,
): readonly string[] {
  const uutilsDir = getWorkspaceConfig().uutilsDir;
  const uutils = uutilsDir && path.join(uutilsDir, "coreutils.exe");
  const restored = (["TEMP", "TMP"] as const).flatMap((name) =>
    env[name] === undefined ? [] : [`${name}=${env[name]}`],
  );
  const [program = ""] = argv;
  if (
    verbatim ||
    !uutils ||
    !existsSync(uutils) ||
    restored.length === 0 ||
    /\.(?:bat|cmd)$/i.test(program) ||
    // `env` reads a leading `NAME=VALUE` as a variable, not a program.
    program.includes("=")
  ) {
    return argv;
  }
  return [uutils, "env", ...restored, ...argv];
}

/**
 * The launcher and its arguments for a command held under MXC, now that its
 * working folder and environment are known.
 */
export function mxcLaunch(
  command: MxcCommand,
  context: {
    cwd?: string;
    env: Record<string, string | undefined>;
    /**
     * The request holds a secret, so it goes in a file of its own, which
     * the caller deletes once the program has started, in place of the
     * launcher's command line, which another process can read.
     */
    privateRequest?: true;
    windowsVerbatimArguments?: boolean;
  },
): { args: string[]; file: string; request?: string } {
  const request = JSON.stringify(
    mxcRequest({
      commandLine: windowsCommandLine(
        withTempRestored(
          command.argv,
          context.env,
          context.windowsVerbatimArguments,
        ),
        context.windowsVerbatimArguments,
      ),
      cwd: context.cwd,
      env: context.env,
      filesystem: command.filesystem,
    }),
  );
  if (context.privateRequest) {
    // In the sandbox's own folder, which every request closes.
    const file = path.join(
      sandboxStateDir(),
      "mxc-requests",
      `private-${randomUUID()}.json`,
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, request, { flag: "wx", mode: 0o600 });
    return { args: ["--config", file], file: command.file, request: file };
  }
  const inline = Buffer.from(request).toString("base64");
  if (inline.length <= MXC_INLINE_LIMIT) {
    return { args: ["--config-base64", inline], file: command.file };
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
  return { args: ["--config", file], file: command.file };
}
