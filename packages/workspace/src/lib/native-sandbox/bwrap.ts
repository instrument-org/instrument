import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { hostPathWithin } from "../host-path";
import { levelAllowingEveryFolder, ruleRank } from "../permissions/rules";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { dotEntriesIn } from "./disk";
import { appEnv, depthOf, resolveReal, toolCaches } from "./host";
import { probeSandbox, type ProbeResult } from "./probe";
import { type NativeReach, reachesSshKeys } from "./reach";

const BWRAP = "/usr/bin/bwrap";

/**
 * A step inside the sandbox that closes every file descriptor the command
 * would inherit but its standard streams, then runs it. On Linux a spawned program inherits whatever the app holds open
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
        'for f in /proc/self/fd/*; do f=${f##*/}; case $f in 0|1|2) ;; *) eval "exec $f>&-" 2>/dev/null ;; esac; done; exec "$@"',
        "bash",
      ]
    : [];
}

let bwrapProbe: ProbeResult | undefined;

/** Whether bubblewrap is installed where the app runs it from. */
export function bwrapInstalled(): boolean {
  return existsSync(BWRAP);
}

/**
 * Whether bubblewrap can make a sandbox from this process: Linux with bwrap
 * installed and user namespaces open to it. Ubuntu closes them to
 * unprivileged programs, and the app's own AppArmor profile, which the
 * `.deb` installs, opens them for the app and what it starts.
 */
export function bwrapState(): ProbeResult {
  if (process.platform !== "linux") {
    return "unavailable";
  }
  if (bwrapProbe === undefined || bwrapProbe === "failed") {
    bwrapProbe = probeSandbox(
      BWRAP,
      ["--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev", "/usr/bin/true"],
      userNamespacesClosed,
    );
  }
  return bwrapProbe;
}

/**
 * The kernel settings that close user namespaces to an unprivileged program,
 * which bubblewrap needs: Debian's switch, a limit of none, and Ubuntu's
 * AppArmor restriction, which the app's own profile lifts where the `.deb`
 * installed it. Read only once a probe has failed, so a restriction the
 * profile lifted is never taken for one in force.
 */
function userNamespacesClosed(): boolean {
  const reads = (file: string) => {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return undefined;
    }
  };
  return (
    reads("/proc/sys/kernel/unprivileged_userns_clone") === "0" ||
    reads("/proc/sys/user/max_user_namespaces") === "0" ||
    reads("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") === "1"
  );
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
 * inside a closed one is bound back over the empty one. Nothing a closed
 * folder holds is listed, so the arguments stay as many however much it
 * holds: bubblewrap refuses more than 9,000, and a workspace's chats add up.
 *
 * Hidden entries in the home folder have no pattern form here, so the home
 * folder is listed and each one is closed by name.
 */
export function bwrapArgs(
  reach: NativeReach,
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
  const { home, rules, dangerouslyAllowEveryFolder } = reach.rules;
  type Access = "none" | "read" | "write";
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
      // Ordered by where the folder really is, which is where it is bound:
      // a folder named deep through a link that leads somewhere shallow
      // binds there before the deeper rules that close what is inside.
      entries.push({
        access,
        depth: depthOf(resolveReal(target)),
        path: target,
        rank,
      });
    }
  };
  add(home, "read", -1);
  // The folder holding what stands in for a closed file, read-only whatever
  // opens a folder above it, so nothing can be put in its place.
  const standIn = unreadableFile();
  add(path.dirname(standIn), "read", 3);
  for (const rule of rules) {
    const level = levelAllowingEveryFolder(
      rule.level,
      rule,
      dangerouslyAllowEveryFolder,
    );
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
  // So is a folder the app keeps read-only inside any folder bound writable
  // (the workspace's Drafts/ before its first draft), which unbound would be
  // as writable as the folder around it.
  const writable = entries
    .filter((entry) => entry.access === "write")
    .map((entry) => entry.path);
  for (const rule of rules) {
    if (
      rule.source === "system" &&
      !rule.file &&
      !rule.dotEntries &&
      levelAllowingEveryFolder(
        rule.level,
        rule,
        dangerouslyAllowEveryFolder,
      ) === "readOnly" &&
      writable.some(
        (folder) =>
          folder !== rule.path && hostPathWithin(folder, rule.path) !== null,
      )
    ) {
      ours.add(rule.path);
    }
  }
  // A file the user sent that is gone is not a folder to make.
  const allowedByName = new Set(
    rules
      .filter(
        (rule) =>
          rule.level === "allow" &&
          !rule.dotEntries &&
          !rule.file &&
          (rule.source === "grant" || rule.source === "folder"),
      )
      .map((rule) => rule.path),
  );
  const remountLater: string[] = [];
  const mounted = new Set<string>();
  const passedThrough = new Set<string>();
  const madeOnTheWay = new Set<string>();
  // The folders between `real` and a closed folder passed through around it,
  // made searchable and no more where bubblewrap would make them listable.
  // They come from the path of what opens there, so they cost the same
  // however much the closed folder holds.
  const onTheWay = (real: string): string[] => {
    const between: string[] = [];
    for (
      let folder = path.dirname(real);
      folder !== path.dirname(folder);
      folder = path.dirname(folder)
    ) {
      if (madeOnTheWay.has(folder) || mounted.has(folder)) {
        if (!madeOnTheWay.has(folder) && !passedThrough.has(folder)) {
          return [];
        }
        return between.toReversed().flatMap((made) => {
          madeOnTheWay.add(made);
          return ["--perms", "0111", "--dir", made];
        });
      }
      between.push(folder);
    }
    return [];
  };
  for (const entry of ordered) {
    const real = resolveReal(entry.path);
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
    args.push(...onTheWay(real));
    mounted.add(real);
    if (entry.access === "write") {
      args.push("--bind", real, real);
    } else if (entry.access === "read") {
      args.push("--ro-bind", real, real);
    } else if (statSync(real).isDirectory()) {
      // An empty folder that refuses to be listed or read, so a program
      // meets "permission denied" there rather than an empty or missing
      // folder it would take at face value. A folder opened inside it keeps
      // search permission, which reaching that folder needs, and holds only
      // what opens in it: a program naming anything else there finds it
      // missing. Where each really is, since that is where it is bound: a
      // folder named through a link can open inside this one.
      const opensInside = ordered.some(
        (other) =>
          other.access !== "none" &&
          other.depth > entry.depth &&
          hostPathWithin(real, resolveReal(other.path)) !== null,
      );
      // Read-only too, so nothing can be made in it to stand in for what it
      // closes and its mode cannot be given back; one a folder opens inside
      // is made read-only after every bind, since bubblewrap makes the
      // folder to bind it to, and a remount leaves the binds inside it be.
      args.push("--perms", opensInside ? "0111" : "0000", "--tmpfs", real);
      if (opensInside) {
        passedThrough.add(real);
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
 * the runtime folder's `sandbox/`, which no sandboxed command may change,
 * and is looked at without following a link: anything there that is not
 * that file is removed and the file made anew, never changed in place, so a
 * link planted there can lead nowhere.
 */
function unreadableFile(): string {
  const file = path.join(
    runtimeLayout(getWorkspaceConfig().runtimeDir).sandbox,
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

/** `file` run in a bubblewrap sandbox made from the reach. */
export function bwrapCommand(
  reach: NativeReach,
  file: string,
  args: readonly string[],
): { args: string[]; file: string } {
  return {
    args: [...bwrapArgs(reach), "--", ...closingInheritedFds(), file, ...args],
    file: BWRAP,
  };
}
