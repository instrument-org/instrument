import { defineCommand } from "just-bash";
import { realpathSync } from "node:fs";
import nodePath from "node:path";

import { CHAT_FOLDER_NAMES, TASKS_DIR_NAME } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { hostPathWithin } from "../host-path";
import { normalizePath } from "../normalize-path";
import { isAtOrUnder } from "../path-containment";
import { RG_DISK_PATH } from "../ripgrep";
import {
  nonTaskMounts,
  classifyVirtualPath,
  resolveReadOnlyHostPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  privateDirLiteralError,
  resolveCommandContext,
  subprocessStdin,
} from "./utils";

export const RG_COMMAND = {
  description:
    "Search file contents and list files with ripgrep. Pipe and redirect its output like any other command (e.g. `rg -l TODO | head`).",
  name: "rg",
} as const;

/**
 * The most stdout `rg` may write before it is stopped, in characters.
 *
 * Every byte of it is collected, rewritten, and filtered on the main thread,
 * then handed whole to the next pipeline stage, since just-bash pipelines do not
 * stream (vercel-labs/just-bash#415). `rg --files` over a few large attached
 * folders prints about 50 MB of paths, and piping that into `rg -i` or `head`
 * froze the window for eight seconds and grew the heap by 2 GB; the same search
 * filtered inside ripgrep with `--iglob` took 26 ms. A later stage cannot stop
 * the producer, so the cap is on the producer.
 */
const RG_MAX_STDOUT = 8 * 1024 * 1024;

const RG_MAX_STDOUT_ERROR = `${RG_COMMAND.name}: stopped after ${RG_MAX_STDOUT / 1024 / 1024} MB of output, which the app collects in full before a pipe or redirection sees any of it. Narrow it inside rg: \`--iglob '*name*'\` (case-insensitive) or \`-g '*.ext'\` to filter paths, a narrower folder, or \`-l\` / \`-m N\` to shorten a content search.\n`;

/**
 * Flags that make ripgrep run another program: `--pre`/`--pre-glob` hand every
 * candidate file to a command of the agent's choosing, `--hostname-bin` runs
 * one outright, and `-z`/`--search-zip` decompresses through external tools.
 * They are what would turn a read-only binary into an execution vector, which
 * is the assumption `resolveReadOnlyHostPath` is documented to rely on, so they
 * are refused rather than sanitized.
 *
 * The denylist only sees argv, but ripgrep also reads these same flags from the
 * file named by `RIPGREP_CONFIG_PATH`, which the agent can set in its own bash
 * env. `--no-config` on the exec argv (below) is what keeps that path from
 * reintroducing a `--pre` the denylist never inspected.
 */
const DENIED_LONG_FLAGS = new Set([
  "--hostname-bin",
  "--pre",
  "--pre-glob",
  "--search-zip",
]);

/** Short flag with the same effect as `--search-zip`, including when bundled. */
const DENIED_SHORT_FLAG = "z";

/**
 * Short flags whose value can be attached to the cluster that introduces them.
 *
 * Where a scan for a bundled `-z` has to stop: everything after one of these
 * letters is that flag's value rather than more flags, so `-ez` is `-e z`, a
 * search for the pattern `z`, and reading it as `-e -z` refuses a legitimate
 * search. Taken from `rg --help` for the build we bundle. A value-taking flag
 * missing from this set costs a refusal that should have been allowed; only a
 * letter wrongly *in* it would let `-z` through, so it grows by checking the
 * help rather than by guessing.
 */
const VALUE_SHORT_FLAGS = new Set("ABCEMTdefgjmrt");

/** Glob metacharacters, each matched literally inside a one-member class. */
const GLOB_METACHARACTERS = /[*?[{}\\]/g;

export function createRgCommand({
  layout,
  chatId,
}: {
  /** The shell's own layout, so rg reaches exactly the mounts the shell has. */
  layout: WorkspaceFsLayout;
  chatId: ChatId;
}) {
  return defineCommand(RG_COMMAND.name, async (args, ctx) => {
    const denied = args.map((arg) => deniedFlag(arg)).find(Boolean);
    if (denied) {
      return {
        exitCode: 2,
        stderr: `${RG_COMMAND.name}: ${denied} is not available in this environment because it runs another program.\n`,
        stdout: "",
      };
    }

    const bridged = bridgePathArgs(args, layout, (arg) =>
      ctx.fs.resolvePath(ctx.cwd, arg),
    );
    if ("error" in bridged) {
      return { exitCode: 2, stderr: `${bridged.error}\n`, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(chatId, ctx);
    const masked = maskSearchRoots(bridged.args, layout, taskCwd);
    if ("error" in masked) {
      return { exitCode: 2, stderr: `${masked.error}\n`, stdout: "" };
    }
    const stdin = subprocessStdin(ctx.stdin);

    const result = await execShim(
      RG_DISK_PATH,
      [
        "--no-config",
        "--path-separator=/",
        ...withPrivateDirDenied(masked.args, masked.globs),
      ],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env,
        maxBuffer: { stdout: RG_MAX_STDOUT },
        // ripgrep picks between reading stdin and walking the working directory
        // by stat'ing fd 0, so the piped bytes have to reach it as a real pipe.
        // Handing it an ignored stdin instead makes `cmd | rg PATTERN` search
        // the task folder and report those matches as if they came from the
        // pipe. With no pipe, an ignored stdin is what selects the walk.
        //
        // The pipe has to be there even when it carried nothing: `false | rg
        // PATTERN` reads an empty pipe and matches nothing, the same as on a
        // host. The bytes alone cannot say whether a pipe existed, which is
        // what `stdinConnected` (a local patch on just-bash) is for.
        ...((stdin ?? ctx.stdinConnected)
          ? { input: stdin ?? Buffer.alloc(0) }
          : { stdin: "ignore" }),
      },
    );

    if (result.isMaxBuffer) {
      // The prefix it wrote is dropped rather than returned: piped onward it
      // reads as a complete listing, and a filter over it silently misses
      // everything past the cut.
      return {
        exitCode: 2,
        stderr: RG_MAX_STDOUT_ERROR,
        stdout: "",
      };
    }

    const streams = mapStreams(shimOutput(result, RG_COMMAND.name), (text) =>
      filterShellOutput(
        text,
        layout,
        // `--path-separator=/` already makes ripgrep print POSIX paths, so the
        // separator rewrite has nothing to fix here and would only corrupt
        // backslashes inside matched lines and `--json` escapes.
        { rewriteSeparators: false },
      ),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}

/**
 * Rewrite the sandbox's virtual paths to the host paths ripgrep has to receive,
 * and refuse the ones that name the private dir.
 *
 * Only arguments that name a mount are rewritten. Anything else starting with
 * `/` is left alone: it is far more likely to be a regex (`rg '/task/'`) than a
 * path, and a real absolute path is no wider a capability than the `python` and
 * `node` hatches already documented in the agent sandbox. A path that resolves
 * into the private dir, or out of its mount through a symlink, is refused.
 *
 * The private-dir question is asked of every argument that is not a flag, not
 * only of the ones naming a mount, because ripgrep applies no glob filter to a
 * file named on the command line: the deny glob covers the walk, and
 * `rg NEEDLE .instrument/state.json` goes straight past it. Which positional is
 * the pattern and which is a path would take parsing every flag this wrapper
 * deliberately hands through, so it asks the cheaper question. A *pattern* that
 * resolves into the private dir is refused too, which is a search worth
 * refusing. Everything after `--` is an operand, a leading dash included.
 */
function bridgePathArgs(
  args: string[],
  layout: WorkspaceFsLayout,
  resolveVirtual: (arg: string) => string,
): { args: string[] } | { error: string } {
  const mountPoints = [layout.task, ...nonTaskMounts(layout)].map(
    (mount) => mount.mountPoint,
  );

  const bridged: string[] = [];
  let operandsOnly = false;
  for (const arg of args) {
    const owner = mountPoints.find((mountPoint) =>
      isAtOrUnder(mountPoint, arg),
    );
    const below = owner === undefined ? mountsBelow(layout, arg) : [];
    if (below.length > 0) {
      bridged.push(...below);
      continue;
    }
    if (!owner) {
      const isOperand = operandsOnly || !arg.startsWith("-");
      operandsOnly ||= arg === "--";
      const masked = isOperand
        ? classifyVirtualPath(layout, resolveVirtual(arg))?.masked
        : undefined;
      if (masked === CHAT_FOLDER_NAMES.private) {
        return {
          error: privateDirLiteralError(`${RG_COMMAND.name}: "${arg}"`),
        };
      }
      // The dir itself is left to the deny globs: a bare `tasks` argument is
      // as likely a pattern as a path, and refusing a search for the word
      // would cost more than it guards.
      if (
        masked === TASKS_DIR_NAME &&
        !isMaskedDirItself(resolveVirtual(arg), TASKS_DIR_NAME)
      ) {
        return {
          error: `${RG_COMMAND.name}: ${arg}: path is not accessible`,
        };
      }
      bridged.push(arg);
      continue;
    }
    const hostPath = resolveReadOnlyHostPath(layout, arg);
    if (hostPath === null) {
      return {
        error: `${RG_COMMAND.name}: ${arg}: path is not accessible`,
      };
    }
    bridged.push(hostPath);
  }
  return { args: bridged };
}

/**
 * The host roots of the mounts under a directory that is no mount itself but
 * holds some: `/mnt`, or `/mnt/Home` in a task handed `/mnt/Home/Downloads`
 * and `/mnt/Home/Desktop` alone. The sandbox shows such a directory as the
 * mounts under it, so a search of it is a search of them. Only under the
 * attached-folder root, so neither `/` nor a pattern elsewhere is read as one.
 */
function mountsBelow(layout: WorkspaceFsLayout, arg: string): string[] {
  if (!isAtOrUnder(MOUNT.attachedFolders, arg)) {
    return [];
  }
  return nonTaskMounts(layout).flatMap((mount) => {
    if (mount.mountPoint === arg || !isAtOrUnder(arg, mount.mountPoint)) {
      return [];
    }
    const hostPath = resolveReadOnlyHostPath(layout, mount.mountPoint);
    return hostPath === null ? [] : [hostPath];
  });
}

/** A path's real location, or null for one that does not exist. */
function canonicalPath(hostPath: string): null | string {
  try {
    return realpathSync(hostPath);
  } catch {
    return null;
  }
}

function deniedFlag(arg: string): null | string {
  if (arg.startsWith("--")) {
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    return DENIED_LONG_FLAGS.has(name) ? name : null;
  }
  if (!arg.startsWith("-")) {
    return null;
  }
  // A single dash introduces one or more bundled short flags (`-uz`), so the
  // whole cluster has to be inspected rather than compared -- up to the first
  // flag that takes a value, since the rest of the cluster is that value.
  for (const letter of arg.slice(1)) {
    if (letter === DENIED_SHORT_FLAG) {
      return `-${DENIED_SHORT_FLAG}`;
    }
    if (VALUE_SHORT_FLAGS.has(letter)) {
      return null;
    }
  }
  return null;
}

function escapeGlob(literal: string): string {
  return literal.replaceAll(GLOB_METACHARACTERS, (character) =>
    character === "\\" && nodePath.sep === "\\" ? "/" : `[${character}]`,
  );
}

/**
 * Where ripgrep finds an operand: joined to its working directory as typed
 * rather than normalized, so `..` after a symlink resolves the way the
 * operating system resolves it.
 */
function hostOperand(taskCwd: string, arg: string): string {
  return nodePath.isAbsolute(arg) ? arg : `${taskCwd}${nodePath.sep}${arg}`;
}

/** Two parts of a printed path, joined the way ripgrep joins them. */
function joinPrinted(parent: string, child: string): string {
  if (parent === "" || child === "") {
    return parent || child;
  }
  return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
}

/**
 * The deny globs that keep ripgrep's walk out of every masked entry (the
 * private dir, and a chat's `tasks/` dir) of every mount the search reaches,
 * with the arguments respelled where a glob could not otherwise name them.
 *
 * ripgrep walks the real directories, so the virtual-filesystem mask does not
 * apply, and no glob applies to a file named on the command line either --
 * that half is `bridgePathArgs`'s.
 *
 * A glob cannot simply be anchored at the mount root. ripgrep anchors every
 * glob at its working directory and matches it against each path as printed,
 * after dropping one leading `./` and, from an absolute path, the working
 * directory's own canonical spelling. So a root reached as `..`, `../work/..`
 * or `/Users/.../task` prints as that spelling followed by what is under it,
 * and each of those needs a glob of its own: one per masked entry, per
 * operand whose real location holds a masked mount root, plus one for the
 * walk from the working directory itself. Any argument could be the operand
 * (which one is the pattern would take parsing every flag), so each is asked;
 * a pattern that happens to name a directory above a mount root only adds a
 * glob that excludes the same entries. Where the operand is spelled with a
 * `.` or empty segment that the printed path does not match literally
 * (`././..`, `..//`), it is normalized, which only shortens the spelling the
 * matches are printed with.
 *
 * Each glob is passed twice because ripgrep builds one matcher from every
 * `--glob` and then adds every `--iglob` to it, so a case-insensitive include
 * outranks a case-sensitive exclude no matter which order they were typed in:
 * without the second, `--iglob '.INSTRUMENT/**'` searches the dir. The pair of
 * them also means the exclusion holds for a filesystem that would tell those
 * two directory names apart.
 */
function maskSearchRoots(
  args: string[],
  layout: WorkspaceFsLayout,
  taskCwd: string,
): { args: string[]; globs: string[] } | { error: string } {
  const maskedRoots = [layout.task, ...nonTaskMounts(layout)]
    .filter((mount) => mount.maskedEntries.length > 0)
    .map((mount) => ({
      entries: mount.maskedEntries,
      root: canonicalPath(mount.hostRoot) ?? nodePath.resolve(mount.hostRoot),
    }));
  const cwd = canonicalPath(taskCwd) ?? taskCwd;

  const denied = new Set<string>();
  const denyBelow = (spelling: string, reached: string) => {
    for (const { entries, root } of maskedRoots) {
      const rest = remainderWithin(reached, root);
      if (rest === null) {
        continue;
      }
      for (const entry of entries) {
        denied.add(
          `/${escapeGlob(joinPrinted(joinPrinted(spelling, rest), entry))}/**`,
        );
      }
    }
  };
  const reachesMaskedRoot = (reached: string) =>
    maskedRoots.some(({ root }) => remainderWithin(reached, root) !== null);

  denyBelow("", cwd);

  const respelled: string[] = [];
  let operandsOnly = false;
  for (const arg of args) {
    const isOperand = operandsOnly || !arg.startsWith("-");
    operandsOnly ||= arg === "--";
    // An empty argument names no path: it is the pattern that matches
    // every line.
    const reached =
      isOperand && arg !== "" ? canonicalPath(hostOperand(taskCwd, arg)) : null;
    if (reached === null || !reachesMaskedRoot(reached)) {
      respelled.push(arg);
      continue;
    }
    const spelling = printedSpelling(arg);
    if (spelling !== null) {
      denyBelow(spelling, reached);
      respelled.push(arg);
      continue;
    }
    const normalized = nodePath.normalize(arg);
    const normalizedSpelling = printedSpelling(normalized);
    if (
      normalizedSpelling === null ||
      canonicalPath(hostOperand(taskCwd, normalized)) !== reached
    ) {
      return {
        error: `${RG_COMMAND.name}: ${arg}: path is not accessible; spell it without \`.\` or empty segments`,
      };
    }
    denyBelow(normalizedSpelling, reached);
    respelled.push(normalized);
  }

  return {
    args: respelled,
    globs: [...denied].flatMap((glob) => [
      "--glob",
      `!${glob}`,
      "--iglob",
      `!${glob}`,
    ]),
  };
}

/**
 * Whether a virtual path names a task folder's masked entry itself rather than
 * something inside it.
 */
function isMaskedDirItself(virtualPath: string, entry: string): boolean {
  return (
    normalizePath(virtualPath).toLowerCase() ===
    `${MOUNT.task}/${entry}`.toLowerCase()
  );
}

/**
 * What of an operand ripgrep's glob matcher sees in front of each path under
 * it, or null for a spelling it would not match literally. `.` contributes
 * nothing, since ripgrep drops the leading `./` it prints under it.
 */
function printedSpelling(arg: string): null | string {
  const posix = nodePath.sep === "\\" ? arg.replaceAll("\\", "/") : arg;
  if (posix === "." || posix === "./") {
    return "";
  }
  if (posix === "/") {
    return posix;
  }
  const unprefixed = posix.startsWith("./") ? posix.slice(2) : posix;
  const spelling =
    unprefixed.length > 1 && unprefixed.endsWith("/")
      ? unprefixed.slice(0, -1)
      : unprefixed;
  const segments = spelling.split("/");
  const plain = segments.every(
    (segment, index) =>
      segment !== "." &&
      (segment !== "" || (index === 0 && segments.length > 1)),
  );
  return plain ? spelling : null;
}

/**
 * The part of `hostPath` under `parent` as ripgrep prints it below the
 * parent's spelling: "" for the parent itself, or null for a path outside it.
 */
function remainderWithin(parent: string, hostPath: string): null | string {
  return hostPathWithin(parent, hostPath)?.slice(1) ?? null;
}

/**
 * The agent's arguments with the private-dir deny globs after them.
 *
 * After, because ripgrep's glob precedence is last-wins: prepended, any
 * positive glob the agent passes overrides them, including a bare `-g '**'`
 * typed without meaning anything by it. Still ahead of a `--` though, since
 * everything past that is a path operand rather than a flag.
 */
function withPrivateDirDenied(
  args: string[],
  globs: readonly string[],
): string[] {
  const operandsFrom = args.indexOf("--");

  return operandsFrom === -1
    ? [...args, ...globs]
    : [...args.slice(0, operandsFrom), ...globs, ...args.slice(operandsFrom)];
}
