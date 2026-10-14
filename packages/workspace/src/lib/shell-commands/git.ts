import { defineCommand } from "just-bash";
import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { gitBinaryPath } from "../git";
import { ruleRefusal } from "../permissions/rules-fs";
import {
  hostPathOf,
  otherFolders,
  shellPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import {
  collapseProgress,
  execShim,
  mapStreams,
  shimOutput,
} from "./exec-shim";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

// Git config keys, spelled as git spells them.

export const GIT_COMMAND = {
  description:
    `Clone and fetch public repositories over http(s), inspect history, branch, and commit locally. ` +
    `Works in any folder the chat can reach (\`git -C <folder> log\`, or \`cd\` there first); in a read-only one it may only read (log, show, diff, blame, status), and committing there needs write on the repository's own folder. ` +
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
  layout,
  chatId,
}: {
  layout: WorkspaceFsLayout;
  chatId: ChatId;
}) {
  return defineCommand(GIT_COMMAND.name, async (args, ctx) => {
    const rejection = rejectUnsafeArgs(args);
    if (rejection) {
      return fail(rejection);
    }

    const { env, hostCwd } = resolveCommandContext(chatId, ctx);

    // What git may do in a folder is what the rules let the agent do there:
    // where they keep changes out, git may only read; see `readsOnly`.
    const resolvedArgs = hostPathArgs(args);
    let refusal: string | undefined;
    if (layout.rules && !readsOnly(args)) {
      // The path `init` or `clone` is given is the repository's folder, which
      // may not be there yet.
      const subcommand = findSubcommand(args);
      const makesFolder =
        subcommand !== undefined &&
        (subcommand.name === "init" || subcommand.name === "clone");
      for (const [index, target] of [".", ...args.map(pathValueOf)].entries()) {
        if (!target.startsWith("/") && target !== ".") {
          continue;
        }
        refusal ??= ruleRefusal({
          hostPath: hostPathOf(ctx.fs.resolvePath(ctx.cwd, target)),
          // Index 0 is the working folder, so an argument sits one later.
          isDirectory: makesFolder && index - 1 > subcommand.index,
          op: "write",
          rules: layout.rules,
          spell: shellPath,
        });
      }
    }
    if (refusal) {
      return fail(
        `git may only read here (log, show, diff, blame, status, and the other commands that write nothing). ${refusal}`,
      );
    }

    const escape = findEscapingPathValue(resolvedArgs, hostCwd, layout);
    if (escape) {
      return fail(
        `${escape} points outside this conversation's folder and every folder you reach. ` +
          `git can only operate on repositories inside those.`,
      );
    }

    const result = await execShim(
      gitBinaryPath(),
      [
        ...FORCED_CONFIG.flatMap((entry) => ["-c", entry]),
        ...(readsOnly(args) ? ["--no-optional-locks"] : []),
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

    const streams = mapStreams(shimOutput(result, GIT_COMMAND.name), (text) =>
      filterShellOutput(collapseProgress(text)),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}

/** The path an argument names: the value of a `--flag=value` path flag, else the argument. */
function pathValueOf(arg: string): string {
  const eqIndex = arg.indexOf("=");
  return eqIndex > 0 && PATH_VALUE_FLAGS.has(arg.slice(0, eqIndex))
    ? arg.slice(eqIndex + 1)
    : arg;
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${GIT_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

/**
 * Report the first argument naming a path outside every folder the chat reaches,
 * resolved against the real host directory git runs in.
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
    layout.chat.hostRoot,
    ...otherFolders(layout).map((folder) => folder.hostRoot),
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
