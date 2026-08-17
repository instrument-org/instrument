import { defineCommand } from "just-bash";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput, pathVariants } from "../filter-shell-output";
import { isAtOrUnder } from "../path-containment";
import { RG_DISK_PATH } from "../ripgrep";
import { taskDir } from "../task-dir-utils";
import {
  buildWorkspaceFsLayout,
  nonTaskMounts,
  privateMountPoint,
  resolveReadOnlyHostPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { execShim, shimOutput } from "./exec-shim";
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
 * Flags that make ripgrep run another program: `--pre`/`--pre-glob` hand every
 * candidate file to a command of the agent's choosing, `--hostname-bin` runs
 * one outright, and `-z`/`--search-zip` decompresses through external tools.
 * They are what would turn a read-only binary into an execution vector, which
 * is the assumption `resolveReadOnlyHostPath` is documented to rely on, so they
 * are refused rather than sanitized.
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

/**
 * Keeps ripgrep out of the task's private dir during a walk.
 *
 * Anchored to each search root, which is where the task's own private dir sits.
 * ripgrep walks the real directory, so the virtual-filesystem mask over that
 * dir does not apply, and no glob applies to a file named on the command line
 * either -- that half is `bridgePathArgs`'s.
 *
 * Spelled twice because ripgrep builds one matcher from every `--glob` and then
 * adds every `--iglob` to it, so a case-insensitive include outranks a
 * case-sensitive exclude no matter which order they were typed in: without the
 * second line, `--iglob '.INSTRUMENT/**'` searches the dir. The pair of them
 * also means the exclusion holds for a filesystem that would tell those two
 * directory names apart.
 */
const PRIVATE_DIR_DENY_GLOBS = [
  "--glob",
  `!/${TASK_FOLDER_NAMES.private}/**`,
  "--iglob",
  `!/${TASK_FOLDER_NAMES.private}/**`,
] as const;

export function createRgCommand({
  attachedFolders,
  projectFolderName,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  projectFolderName?: string;
  taskId: TaskId;
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

    const layout = buildWorkspaceFsLayout({
      attachedFolders,
      projectFolderName,
      taskHostRoot: taskDir(taskId),
    });

    const bridged = bridgePathArgs(args, layout, (arg) =>
      ctx.fs.resolvePath(ctx.cwd, arg),
    );
    if ("error" in bridged) {
      return { exitCode: 2, stderr: `${bridged.error}\n`, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const stdin = subprocessStdin(ctx.stdin);

    const result = await execShim(
      RG_DISK_PATH,
      ["--path-separator=/", ...withPrivateDirDenied(bridged.args)],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env,
        // ripgrep picks between reading stdin and walking the working directory
        // by stat'ing fd 0, so the piped bytes have to reach it as a real pipe.
        // Handing it an ignored stdin instead makes `cmd | rg PATTERN` search
        // the task folder and report those matches as if they came from the
        // pipe. With no pipe, an ignored stdin is what selects the walk.
        ...(stdin ? { input: stdin } : { stdin: "ignore" }),
      },
    );

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(
        virtualizeOutput(shimOutput(result, RG_COMMAND.name), layout),
        taskDir(taskId),
        // `--path-separator=/` already makes ripgrep print POSIX paths, so the
        // separator rewrite has nothing to fix here and would only corrupt
        // backslashes inside matched lines and `--json` escapes.
        { rewriteSeparators: false },
      ),
    };
  });
}

/**
 * Map every mount's real location back to its virtual path so match paths stay
 * sandbox-shaped.
 *
 * A host root is matched in every spelling it can be printed in, not just the
 * one the layout stores. `--path-separator=/` makes ripgrep print a Windows
 * host root as `C:/Users/...` while the layout holds `C:\Users\...`, so
 * comparing the stored spelling alone silently matches nothing and the match
 * paths leak out as host paths.
 *
 * Longest spelling first, so a mount nested inside another wins over its parent.
 */
export function virtualizeOutput(
  output: string,
  layout: WorkspaceFsLayout,
): string {
  const rewrites = nonTaskMounts(layout)
    .flatMap((mount) =>
      pathVariants(mount.hostRoot).map((hostRoot) => ({
        hostRoot,
        mountPoint: mount.mountPoint,
      })),
    )
    .sort((a, b) => b.hostRoot.length - a.hostRoot.length);

  let result = output;
  for (const { hostRoot, mountPoint } of rewrites) {
    result = result.replaceAll(hostRoot, mountPoint);
  }
  return result;
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
 * refusing.
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
  for (const arg of args) {
    const owner = mountPoints.find((mountPoint) =>
      isAtOrUnder(mountPoint, arg),
    );
    if (!owner) {
      if (
        !arg.startsWith("-") &&
        isAtOrUnder(privateMountPoint(MOUNT.task), resolveVirtual(arg))
      ) {
        return {
          error: privateDirLiteralError(`${RG_COMMAND.name}: "${arg}"`),
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

/**
 * The agent's arguments with the private-dir deny globs after them.
 *
 * After, because ripgrep's glob precedence is last-wins: prepended, any
 * positive glob the agent passes overrides them, including a bare `-g '**'`
 * typed without meaning anything by it. Still ahead of a `--` though, since
 * everything past that is a path operand rather than a flag.
 */
function withPrivateDirDenied(args: string[]): string[] {
  const operandsFrom = args.indexOf("--");

  return operandsFrom === -1
    ? [...args, ...PRIVATE_DIR_DENY_GLOBS]
    : [
        ...args.slice(0, operandsFrom),
        ...PRIVATE_DIR_DENY_GLOBS,
        ...args.slice(operandsFrom),
      ];
}
