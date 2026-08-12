import { defineCommand } from "just-bash";
import path from "node:path";

import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { gitBinaryPath } from "../git";
import { taskDir } from "../task-dir-utils";
import { execShim } from "./exec-shim";
import {
  bridgeFlagValuePath,
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
} from "./utils";

// Git config keys, spelled as git spells them.

export const GIT_COMMAND = {
  description:
    `Clone and fetch public repositories over http(s), inspect history, branch, and commit locally. ` +
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
 * Keep only the last state of each carriage-return progress line, which is what
 * a terminal would have shown. `git clone` redraws counters this way, so a large
 * repository otherwise arrives as one ~20 KB line of "Updating files: 1%...2%"
 * that survives line-based truncation and buries the real output.
 */
export function collapseProgress(output: string) {
  // The lookahead spares \r\n, so Windows line endings are left intact.
  return output.replaceAll(/[^\n]*\r(?!\n)/g, "");
}

export function createGitCommand(taskId: TaskId) {
  return defineCommand(GIT_COMMAND.name, async (args, ctx) => {
    const rejection = rejectUnsafeArgs(args);
    if (rejection) {
      return {
        exitCode: 1,
        stderr: `${GIT_COMMAND.name}: ${rejection}\n`,
        stdout: "",
      };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    // resolvePathArgs only rewrites arguments that start with `/`, so bridge
    // the inline `--git-dir=/task/...` form first. Without this it reaches the
    // containment check as a literal `/task/...` and is reported as escaping,
    // while the space-separated spelling of the same thing works.
    const resolvedArgs = resolvePathArgs(
      args.map((arg) =>
        PATH_VALUE_FLAGS.has(arg.slice(0, arg.indexOf("=")))
          ? bridgeFlagValuePath(arg, taskId, taskCwd, (p) =>
              ctx.fs.resolvePath(ctx.cwd, p),
            )
          : arg,
      ),
      taskId,
      ctx,
    );

    const escape = findEscapingPathValue(
      resolvedArgs,
      taskCwd,
      taskDir(taskId),
    );
    if (escape) {
      return {
        exitCode: 1,
        stderr:
          `${GIT_COMMAND.name}: ${escape} points outside the task directory. ` +
          `git can only operate on repositories inside the task.\n`,
        stdout: "",
      };
    }

    const result = await execShim(
      gitBinaryPath(),
      [...FORCED_CONFIG.flatMap((entry) => ["-c", entry]), ...resolvedArgs],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        // Isolation from the user's git config and credentials comes from
        // gitSubprocessEnv, which resolveCommandContext applies to every hatch.
        env,
        input: subprocessStdin(ctx.stdin),
      },
    );

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(collapseProgress(result.all), taskDir(taskId)),
    };
  });
}

/**
 * Report the first argument naming a path outside the task. `resolvePathArgs`
 * already quarantines sandbox-absolute paths, so what is left is relative
 * traversal, which resolves against the real host directory the task lives in.
 *
 * Repeated `-C` is why this folds rather than checking each value on its own:
 * git resolves each non-absolute `-C` relative to the preceding one, so
 * `-C .. -C .. -C ..` climbs three levels while three independent checks each
 * see a single harmless `..`. Every later path value is resolved against the
 * directory the accumulated `-C` chain lands in, for the same reason.
 */
function findEscapingPathValue(
  args: string[],
  taskCwd: string,
  taskRoot: string,
): string | undefined {
  const escapes = (value: string, from: string) => {
    const relative = path.relative(taskRoot, path.resolve(from, value));
    return relative.startsWith("..") || path.isAbsolute(relative);
  };

  let cwd = taskCwd;
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
