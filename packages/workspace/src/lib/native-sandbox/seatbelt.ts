import { execFileSync } from "node:child_process";
import path from "node:path";

import { COMMAND_LINE_TOOLS_INSTALLER } from "../command-line-tools-env";
import { hostPathWithin } from "../host-path";
import { REACHABLE_APPS } from "../permissions/apps";
import { levelAllowingEveryFolder, ruleRank } from "../permissions/rules";
import { getWorkspaceConfig } from "../workspace-config";
import { appEnv, depthOf, resolveReal, spellings, toolCaches } from "./host";
import { probeSandbox, type ProbeResult } from "./probe";
import { type NativeReach, reachesSshKeys } from "./reach";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * Where a process keeps what it writes besides files: the terminal, the
 * null device, its own descriptors. Changing a disk's device takes an
 * administrator, so the folder as a whole is open.
 */
const DEVICES = "/dev";

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
  const { home, rules, dangerouslyAllowEveryFolder } = reach.rules;
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
      depth: depthOf(resolveReal(home)),
      rank: -1,
      text: `(deny file-write* (subpath ${sbplString(resolveReal(home))}))`,
    },
  ];
  // A listed folder lets a program list folders and read metadata, each
  // named as one operation, which Seatbelt ranks above a rule for
  // `file-read*` whatever the order: last match wins only between rules
  // naming operations alike. So every rule inside one says the same for
  // those two operations as well, or a closed folder in it would list and
  // an open one would not read.
  const listedFolders = rules
    .filter(
      (rule) =>
        rule.listed &&
        levelAllowingEveryFolder(
          rule.level,
          rule,
          dangerouslyAllowEveryFolder,
        ) === "ask",
    )
    .flatMap((rule) => spellings(rule.path));
  const inListed = (spelled: string) =>
    listedFolders.some((folder) => hostPathWithin(folder, spelled) !== null);
  /** The same rule for the two operations a listed folder names alone. */
  const alike = (
    verdict: "allow" | "deny",
    filter: string,
    spelled: string,
    listed = false,
  ) =>
    !listed && inListed(spelled)
      ? [`(${verdict} file-read-data file-read-metadata ${filter})`]
      : [];
  for (const rule of rules) {
    const level = levelAllowingEveryFolder(
      rule.level,
      rule,
      dangerouslyAllowEveryFolder,
    );
    const listed = rule.listed === true && level === "ask";
    const filter = (spelled: string) =>
      rule.dotEntries
        ? `(regex #"^${regexEscape(spelled)}/\\.[^/]+(/|$)")`
        : rule.file
          ? `(literal ${sbplString(spelled)})`
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
    // A listed folder lists its folders and answers metadata, and opens no
    // file.
    const texts = (spelled: string) =>
      level === "allow"
        ? [
            `(allow file-read* file-write* network-outbound ${filter(spelled)})`,
            ...alike("allow", filter(spelled), spelled),
          ]
        : level === "readOnly"
          ? [
              `(allow file-read* ${filter(spelled)})`,
              ...alike("allow", filter(spelled), spelled),
              `(deny file-write* ${filter(spelled)})`,
            ]
          : [
              `(deny file-read* file-write*${socketsClosed ? " network-outbound" : ""} ${filter(spelled)})`,
              ...alike("deny", filter(spelled), spelled, listed),
              ...(listed
                ? [
                    `(allow file-read-data (require-all ${filter(spelled)} (vnode-type DIRECTORY)))`,
                    `(allow file-read-metadata ${filter(spelled)})`,
                  ]
                : []),
            ];
    entries.push(
      ...spellings(rule.path).flatMap((spelled) =>
        texts(spelled).map((text) => ({
          depth: depthOf(spelled) + (rule.dotEntries ? 1 : 0),
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
      spellings(opened).flatMap((spelled) => {
        const filter = `(subpath ${sbplString(spelled)})`;
        return [
          `(allow ${access} ${filter})`,
          ...(access.includes("file-read*")
            ? alike("allow", filter, spelled)
            : []),
        ].map((text) => ({
          depth: depthOf(spelled),
          opened: spelled,
          rank: 3,
          text,
        }));
      }),
    );
  entries.push(
    ...opens([DEVICES], "file-write*"),
    ...opens(toolCaches(), "file-read* file-write*"),
    ...opens(reach.readOnly, "file-read*"),
    // Closed to changes as well, so a rule that opens a folder holding one
    // (an Ask first place under folders-without-asking) does not open it.
    ...reach.readOnly.flatMap((closed) =>
      spellings(closed).map((spelled) => ({
        depth: depthOf(spelled),
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
    const level = levelAllowingEveryFolder(
      rule.level,
      rule,
      dangerouslyAllowEveryFolder,
    );
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
  // No Apple Events and no opening apps: a command could otherwise have
  // another app do what the profile keeps it from, outside any sandbox.
  // The app's own scripts reach an app only once the person connected it
  // in Apps, and then run outside the sandbox, from the Mac apps' server
  // (lib/mac-apps).
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
    // Registering a launchd job (`launchctl`, and the `cron`/`at` spoolers)
    // hands code to launchd to run later, in the login session, under no
    // profile of ours. Allow-by-default leaves that open, so it is denied
    // here the way Apple's own profiles opt into it: the operation holds
    // whatever starts the job, a copy of the binary or a script included.
    "(deny job-creation)",
  );
  // Some apps' work runs in their own services rather than in the program
  // that asks for it, so those are closed until the person allows the app,
  // as an app's Apple Events are.
  const closedServices =
    reach.closedServices ?? REACHABLE_APPS.flatMap(({ services }) => services);
  if (closedServices.length > 0) {
    const filters = closedServices.map(
      ({ kind, name }) => `(${kind} ${sbplString(name)})`,
    );
    texts.push(`(deny mach-lookup ${filters.join(" ")})`);
  }
  // A program signals only what started inside this same command: its own
  // children, and itself. The person's other processes, and what an earlier
  // command left running, are out of reach; the agent stops its own through
  // `kill`, which runs in the app and checks the pid is one it started.
  texts.push("(deny signal)", "(allow signal (target same-sandbox))");
  return ["(version 1)", "(allow default)", ...texts].join("\n");
}

function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function regexEscape(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let seatbeltProbe: ProbeResult | undefined;

/**
 * Whether a Seatbelt profile can be applied from this process: macOS, with
 * `sandbox-exec` where the system keeps it. A process that is itself
 * sandboxed in a way that refuses another profile gets no answer, and runs
 * no native command.
 */
export function seatbeltState(): ProbeResult {
  if (process.platform !== "darwin") {
    return "unavailable";
  }
  if (seatbeltProbe === undefined || seatbeltProbe === "failed") {
    // Only a missing sandbox-exec says Seatbelt cannot be had here; a probe
    // that fails beside it is no answer, and nothing runs unsandboxed on it.
    seatbeltProbe = probeSandbox(
      SANDBOX_EXEC,
      ["-p", "(version 1)(allow default)", "/usr/bin/true"],
      () => false,
    );
  }
  return seatbeltProbe;
}

/** Whether Seatbelt holds the native commands this process starts. */
export function seatbeltAvailable(): boolean {
  return seatbeltState() === "works";
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
 * `file` run under the reach's profile: through the app's launcher with the
 * profile compiled, or through sandbox-exec where the launcher is missing or
 * cannot compile it.
 */
export function seatbeltCommand(
  reach: NativeReach,
  file: string,
  args: readonly string[],
): { args: string[]; file: string } {
  const profile = profileOf(reach);
  const helper = getWorkspaceConfig().seatbeltHelperPath;
  const bytecode = helper ? compiledProfile(helper, profile) : undefined;
  return helper && bytecode
    ? { args: ["run", bytecode, file, ...args], file: helper }
    : { args: ["-p", profile, file, ...args], file: SANDBOX_EXEC };
}
