import { defineCommand } from "just-bash";
import path from "node:path";

import { MOUNT } from "../../mount-points";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { gitBinaryPath } from "../git";
import { taskDir } from "../task-dir-utils";
import {
  buildWorkspaceFsLayout,
  hostPathEscapesMount,
  isMaskedPrivatePath,
  nonTaskMounts,
  resolveHostPath,
  type WorkspaceFsLayout,
  type WorkspaceFsMount,
} from "../workspace-fs-layout";
import {
  collapseProgress,
  execShim,
  mapStreams,
  shimOutput,
} from "./exec-shim";
import { virtualizeOutput } from "./rg";
import {
  bridgeFlagValuePath,
  privateDirLiteralError,
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
} from "./utils";

// Git config keys, spelled as git spells them.

export const GIT_COMMAND = {
  description:
    `Clone and fetch public repositories over http(s), inspect history, branch, and commit locally. ` +
    `Works in an attached folder by its mount path (\`git -C ${MOUNT.attachedFolders}/<folder> log\`, or \`cd\` there first); in a read-only one it may only read (log, show, diff, blame, status), and committing there needs the folder attached read and write. ` +
    `No credentials are configured, so private repositories, pushing, and ssh:// remotes are unavailable. ` +
    `Pass commit messages with -m or -F; there is no editor. ` +
    `A large clone that outlives the call keeps running in the background rather than failing, and leaves a partial directory to delete if it is stopped.`,
  name: "git",
} as const;

/**
 * Flags that relocate the binaries git runs. `--upload-pack`/`--receive-pack`
 * only reach a local command over the ssh and file transports, which
 * `gitSubprocessEnv`'s protocol allowlist already excludes; they are rejected
 * anyway so the guarantee does not rest on a single env var.
 */
const BLOCKED_FLAGS = new Set([
  "--exec-path",
  "--receive-pack",
  "--upload-pack",
]);

/** Config sections that reintroduce user credentials or run arbitrary commands. */
const BLOCKED_CONFIG_SECTIONS = new Set([
  "alias", // Rewrites any subcommand, bypassing every check below.
  "credential",
  "filter", // smudge/clean run arbitrary commands on checkout.
  "include",
  "includeif", // Both pull the user's config back in by path.
  "protocol", // Moot under the protocol allowlist; rejected so the intent is explicit.
  "receivepack",
  "uploadpack",
]);

/**
 * Config leaf keys that name a command or credential source, wherever they
 * appear (`core.sshCommand`, `remote.<name>.proxy`, `diff.external`, ...).
 */
const BLOCKED_CONFIG_LEAVES = new Set([
  "askpass",
  "command", // diff.<driver>.command, run against a matching .gitattributes.
  "driver", // merge.<driver>.driver, likewise.
  "editor", // Belt to GIT_EDITOR's braces; git runs the editor through a shell.
  "external",
  "fsmonitor",
  "gitproxy",
  "helper",
  "hookspath",
  "process",
  "proxy",
  "receivepack",
  "sshcommand",
  "templatedir", // Seeds .git/hooks from a directory of the agent's choosing.
  "uploadpack",
  "worktree",
]);

/**
 * Config the agent cannot override, prepended to every invocation. Command-line
 * config outranks every config file, so unlike the argv denylist these also
 * hold against a key the agent wrote into a repo with `git config`.
 */
const FORCED_CONFIG = [
  // Windows-only in effect: git's mingw layer reads it to address files through
  // the Unicode `\\?\` APIs instead of the 260-character MAX_PATH ones. The
  // task prefix (`…\Instrument\workspace\tasks\<63-char id>\work\`) already
  // spends up to half that budget, so a clone of a repository with any depth to
  // it fails with "Filename too long" without this. It has to arrive as
  // command-line config: a clone has no repository config to read yet, and
  // GIT_CONFIG_GLOBAL is deliberately empty.
  "core.longpaths=true",
  // core.quotepath=false keeps non-ASCII filenames raw instead of
  // octal-escaped and quoted, so they parse and stat correctly on every OS.
  "core.quotepath=false",
  // An empty helper resets the list built from config files, so a
  // `git config credential.helper store` cannot reach the user's saved tokens
  // (nor osxkeychain, nor the credential manager dugite ships on GIT_EXEC_PATH).
  "credential.helper=",
];

/**
 * Flags whose value names a path git reads or writes. `--file` covers
 * `git config --file`, which otherwise both reads and writes any host file.
 */
const PATH_VALUE_FLAGS = new Set([
  "--file",
  "--git-dir",
  "--template",
  "--work-tree",
  "-C",
  "-f",
]);

/**
 * `git config` scopes that name a file outside the task. `--global` is already
 * empty via GIT_CONFIG_GLOBAL and `--system` is off, but both would otherwise
 * report success while writing nowhere useful, or read a file we meant to hide.
 */
const BLOCKED_CONFIG_SCOPES = new Set(["--global", "--system"]);

/**
 * Subcommands that read a repository and write nothing into it, which is all
 * of git that a read-only mount permits. `status` and `diff` refresh the index
 * as a side effect, which `--no-optional-locks` (forced whenever a read-only
 * mount is involved) turns off. Anything not here, and any listing subcommand
 * given something to act on, is a write on the user's folder.
 */
const READ_SUBCOMMANDS = new Set([
  "archive",
  "blame",
  "cat-file",
  "check-ignore",
  "count-objects",
  "describe",
  "diff",
  "diff-tree",
  "for-each-ref",
  "grep",
  "help",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "merge-base",
  "name-rev",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
  "var",
  "version",
  "whatchanged",
]);

/**
 * Flags that turn `branch`, `tag`, and `remote` from a listing into a write
 * even with no name after them: `--unset-upstream` acts on the current
 * branch, `--edit-description` opens the editor on it.
 */
const LISTING_WRITE_FLAGS = new Set([
  "--copy",
  "--delete",
  "--edit-description",
  "--force",
  "--move",
  "--set-upstream-to",
  "--unset-upstream",
  "-C",
  "-c",
  "-D",
  "-d",
  "-f",
  "-M",
  "-m",
  "-u",
]);

/** `git config` flags that only read; anything else on `config` writes. */
const CONFIG_READ_FLAGS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--list",
  "-l",
]);

export function createGitCommand({
  attachedFolders,
  projectFolderName,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  projectFolderName?: string;
  taskId: TaskId;
}) {
  return defineCommand(GIT_COMMAND.name, async (args, ctx) => {
    const rejection = rejectUnsafeArgs(args);
    if (rejection) {
      return fail(rejection);
    }

    const layout = buildWorkspaceFsLayout({
      attachedFolders,
      projectFolderName,
      taskHostRoot: taskDir(taskId),
    });
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const resolveVirtual = (p: string) => ctx.fs.resolvePath(ctx.cwd, p);

    // Where git runs. A mount is a real directory the user attached, so unlike
    // the other native hatches git is handed its host path, both as a working
    // directory (`cd /mnt/repo && git log`) and in arguments (`-C /mnt/repo`,
    // `--git-dir=/mnt/repo/.git`). What the mount's access level still decides
    // is what git may do there; see `readsOnly`.
    const cwdMount = resolveMountPath(layout, resolveVirtual("."));
    if (cwdMount && "error" in cwdMount) {
      return fail(cwdMount.error);
    }
    const hostCwd = cwdMount?.hostPath ?? taskCwd;
    const touchedMounts = new Set<WorkspaceFsMount>(
      cwdMount ? [cwdMount.mount] : [],
    );

    const resolvedArgs: string[] = [];
    for (const arg of args) {
      const bridged = bridgeArg(arg, {
        ctx,
        layout,
        resolveVirtual,
        taskCwd,
        taskId,
      });
      if ("error" in bridged) {
        return fail(bridged.error);
      }
      if (bridged.mount) {
        touchedMounts.add(bridged.mount);
      }
      resolvedArgs.push(bridged.arg);
    }

    const readOnly = [...touchedMounts].find((mount) => mount.readOnly);
    if (readOnly && !readsOnly(args)) {
      return fail(
        `${readOnly.mountPoint} is attached read-only, so git may only read there ` +
          `(log, show, diff, blame, status, and the other commands that write nothing). ` +
          `Committing or changing files in it needs the folder attached read and write; ` +
          `say so if the work needs that.`,
      );
    }

    const escape = findEscapingPathValue(resolvedArgs, hostCwd, layout);
    if (escape) {
      return fail(
        `${escape} points outside the task directory and every attached folder. ` +
          `git can only operate on repositories inside those.`,
      );
    }

    const result = await execShim(
      gitBinaryPath(),
      [
        ...FORCED_CONFIG.flatMap((entry) => ["-c", entry]),
        ...(readOnly ? ["--no-optional-locks"] : []),
        ...resolvedArgs,
      ],
      {
        cancelSignal: ctx.signal,
        cwd: hostCwd,
        // Isolation from the user's git config and credentials comes from
        // gitSubprocessEnv, which resolveCommandContext applies to every hatch.
        env,
        input: subprocessStdin(ctx.stdin),
      },
    );

    // Mount roots back to mount points before the task-dir and home redaction,
    // the order every shim that reaches a mount uses: the home fold would
    // otherwise turn a mount under `~` into a path the agent cannot open.
    const streams = mapStreams(shimOutput(result, GIT_COMMAND.name), (text) =>
      filterShellOutput(
        collapseProgress(virtualizeOutput(text, layout)),
        taskDir(taskId),
      ),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}

/**
 * One argument as git receives it: a mount path becomes its host path, a
 * `/task/...` path its host path relative to the working directory, and any
 * other absolute path a quarantined one. The `--flag=value` spelling is bridged
 * through its value, so `--git-dir=/mnt/repo/.git` and `--git-dir /mnt/repo/.git`
 * land in the same place.
 */
function bridgeArg(
  arg: string,
  {
    ctx,
    layout,
    resolveVirtual,
    taskCwd,
    taskId,
  }: {
    ctx: {
      cwd: string;
      fs: { resolvePath(cwd: string, path: string): string };
    };
    layout: WorkspaceFsLayout;
    resolveVirtual: (p: string) => string;
    taskCwd: string;
    taskId: TaskId;
  },
): { arg: string; mount?: WorkspaceFsMount } | { error: string } {
  const eqIndex = arg.indexOf("=");
  const flag = eqIndex > 0 ? arg.slice(0, eqIndex) : undefined;
  const inline = flag !== undefined && PATH_VALUE_FLAGS.has(flag);
  const value = inline ? arg.slice(eqIndex + 1) : arg;
  if (!value.startsWith("/")) {
    return { arg };
  }

  const mountPath = resolveMountPath(layout, resolveVirtual(value));
  if (mountPath && "error" in mountPath) {
    return mountPath;
  }
  if (mountPath) {
    return {
      arg: inline ? `${flag}=${mountPath.hostPath}` : mountPath.hostPath,
      mount: mountPath.mount,
    };
  }

  // resolvePathArgs only rewrites arguments that start with `/`, so the inline
  // form is bridged through its value first. Without this it reaches the
  // containment check as a literal `/task/...` and is reported as escaping,
  // while the space-separated spelling of the same thing works.
  const [bridged] = inline
    ? [bridgeFlagValuePath(arg, taskId, taskCwd, resolveVirtual)]
    : resolvePathArgs([arg], taskId, ctx);
  return { arg: bridged ?? arg };
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${GIT_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

/**
 * Report the first argument naming a path outside the task and every mount.
 * Absolute virtual paths were already bridged or quarantined, so what is left
 * is relative traversal, which resolves against the real host directory git
 * runs in.
 *
 * Repeated `-C` is why this folds rather than checking each value on its own:
 * git resolves each non-absolute `-C` relative to the preceding one, so
 * `-C .. -C .. -C ..` climbs three levels while three independent checks each
 * see a single harmless `..`. Every later path value is resolved against the
 * directory the accumulated `-C` chain lands in, for the same reason.
 */
function findEscapingPathValue(
  args: string[],
  hostCwd: string,
  layout: WorkspaceFsLayout,
): string | undefined {
  const roots = [
    layout.task.hostRoot,
    ...nonTaskMounts(layout).map((mount) => mount.hostRoot),
  ];
  const escapes = (value: string, from: string) => {
    const resolved = path.resolve(from, value);
    return !roots.some((root) => {
      const relative = path.relative(root, resolved);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  };

  let cwd = hostCwd;
  for (const [index, arg] of args.entries()) {
    const eqIndex = arg.indexOf("=");
    const [flag, value] =
      eqIndex > 0 && PATH_VALUE_FLAGS.has(arg.slice(0, eqIndex))
        ? [arg.slice(0, eqIndex), arg.slice(eqIndex + 1)]
        : [arg, args[index + 1]];

    // A bare `../..` destination (`git init ../../x`, `git clone <url> ../../x`,
    // `git worktree add ../../w`) is a positional, so flag matching alone misses
    // it. Only leading-`..` tokens are treated as paths, to leave branch names,
    // refs, pathspecs, and `-m` messages alone.
    if (!PATH_VALUE_FLAGS.has(flag)) {
      if (/^\.\.[/\\]|^\.\.$/.test(arg) && escapes(arg, cwd)) {
        return arg;
      }
      continue;
    }

    if (value === undefined) {
      continue;
    }
    if (escapes(value, cwd)) {
      return value;
    }
    if (flag === "-C") {
      cwd = path.resolve(cwd, value);
    }
  }

  return undefined;
}

/**
 * The config key a `-c`/`--config-env` token sets. Git accepts the value in the
 * next argv token or attached with `=`, for both flags; missing either spelling
 * makes the whole denylist one token away from a bypass.
 */
function parseConfigKey(args: string[], index: number): string | undefined {
  const arg = args[index];
  if (arg === undefined) {
    return undefined;
  }
  if (arg === "-c" || arg === "--config-env") {
    return args[index + 1]?.split("=")[0];
  }
  const attached = ["--config-env=", "-c"].find(
    (prefix) => arg.startsWith(prefix) && arg.length > prefix.length,
  );
  return attached === undefined
    ? undefined
    : arg.slice(attached.length).split("=")[0];
}

/**
 * Whether an invocation only reads the repository it is pointed at. Judged on
 * the subcommand and, for the ones that list by default and write when given
 * something to act on, on what follows it.
 */
function readsOnly(args: string[]): boolean {
  const subcommand = findSubcommand(args);
  if (!subcommand) {
    // Bare `git`, or global options alone: prints usage.
    return true;
  }
  const rest = args.slice(subcommand.index + 1);
  const positional = rest.filter((arg) => !arg.startsWith("-"));
  const flagNames = rest
    .filter((arg) => arg.startsWith("-"))
    .map((arg) => (arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg));
  switch (subcommand.name) {
    case "branch":
    case "remote":
    case "tag": {
      const listing =
        subcommand.name === "remote"
          ? positional.length === 0 ||
            positional[0] === "show" ||
            positional[0] === "get-url"
          : positional.length === 0;
      return (
        listing && !flagNames.some((flag) => LISTING_WRITE_FLAGS.has(flag))
      );
    }
    case "config": {
      return (
        flagNames.some((flag) => CONFIG_READ_FLAGS.has(flag)) &&
        flagNames.every(
          (flag) => CONFIG_READ_FLAGS.has(flag) || !flag.startsWith("--"),
        )
      );
    }
    case "notes":
    case "stash": {
      return positional[0] === "list" || positional[0] === "show";
    }
    case "reflog": {
      return positional.length === 0 || positional[0] === "show";
    }
    case "submodule": {
      return positional[0] === "status";
    }
    case "worktree": {
      return positional[0] === "list";
    }
    default: {
      return READ_SUBCOMMANDS.has(subcommand.name);
    }
  }
}

/**
 * The host path a virtual path names when it lies in a mount other than the
 * task, refused when it names the mount's masked private dir or leaves the
 * mount through a symlink, and absent for anything else (task paths, device
 * paths, and paths outside every mount keep their existing bridging).
 *
 * A read-write mount gets the same two checks as a read-only one. The access
 * level decides which subcommands run, not whether the binary may be pointed
 * at the folder's own internals or through a link out of it.
 */
function resolveMountPath(
  layout: WorkspaceFsLayout,
  virtualAbsPath: string,
):
  | undefined
  | { error: string }
  | { hostPath: string; mount: WorkspaceFsMount } {
  const resolved = resolveHostPath(layout, virtualAbsPath);
  if (resolved === null || resolved.mount === layout.task) {
    return undefined;
  }
  const { hostPath, mount } = resolved;
  if (isMaskedPrivatePath(mount, virtualAbsPath)) {
    return { error: privateDirLiteralError(`"${virtualAbsPath}"`) };
  }
  if (hostPathEscapesMount(hostPath, mount.hostRoot)) {
    return { error: `${virtualAbsPath}: path is not accessible` };
  }
  return { hostPath, mount };
}

/** Global options whose value is the next argv token, so it is not a subcommand. */
const GLOBAL_VALUE_FLAGS = new Set([
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
  "-C",
  "-c",
]);

function findSubcommand(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("-")) {
      return { index, name: arg };
    }
    if (GLOBAL_VALUE_FLAGS.has(arg)) {
      index++;
    }
  }
  return;
}

function isBlockedConfigKey(key: string): boolean {
  // Git treats section and key names case-insensitively; only a subsection
  // (the quoted middle segment) is case-sensitive, and none are matched here.
  const segments = key.toLowerCase().split(".");
  return (
    BLOCKED_CONFIG_SECTIONS.has(segments[0] ?? "") ||
    BLOCKED_CONFIG_LEAVES.has(segments.at(-1) ?? "")
  );
}

function rejectUnsafeArgs(args: string[]): string | undefined {
  const configWrite = rejectUnsafeConfigWrite(args);
  if (configWrite) {
    return configWrite;
  }

  for (const [index, arg] of args.entries()) {
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (BLOCKED_FLAGS.has(flag)) {
      return `${flag} is not allowed; it would let git run a binary from outside the task.`;
    }

    const configKey = parseConfigKey(args, index);
    if (configKey !== undefined && isBlockedConfigKey(configKey)) {
      return (
        `setting ${configKey} is not allowed. git runs with an isolated ` +
        `configuration: no credential helpers, no user config, and no helper ` +
        `commands from outside the task.`
      );
    }
  }
  return undefined;
}

/**
 * `git config <key> <value>` reaches every key the `-c` denylist covers, and
 * the value persists in the repo for every later invocation. FORCED_CONFIG
 * outranks the file for the keys it names, but it cannot preempt an arbitrary
 * `alias.<anything>`, so the write itself has to be refused.
 *
 * Every argument is tested rather than the one in key position, because where
 * that position is takes parsing git's whole grammar to know. `git config set
 * alias.x '!cmd'` (git 2.46's subcommand form) puts `set` there; any
 * value-taking flag ahead of the key (`git config --file .git/config alias.x
 * '!cmd'`) puts its own value there. Both spellings landed a runnable alias
 * while the first non-flag token was checked. What the wider test costs is a
 * read of one of these keys refused along with the write, which is a listing
 * nobody needs rather than a capability.
 */
function rejectUnsafeConfigWrite(args: string[]): string | undefined {
  const subcommand = findSubcommand(args);
  if (subcommand?.name !== "config") {
    return undefined;
  }

  const rest = args.slice(subcommand.index + 1);
  const scope = rest.find((arg) => BLOCKED_CONFIG_SCOPES.has(arg));
  if (scope) {
    return `git config ${scope} is not allowed; only a repository's own config is writable.`;
  }

  const key = rest.find(
    (arg) => !arg.startsWith("-") && isBlockedConfigKey(arg),
  );
  return key === undefined
    ? undefined
    : `setting ${key} is not allowed, in config files as well as on the command line.`;
}
