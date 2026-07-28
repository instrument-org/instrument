import { defineCommand } from "just-bash";

import { TASK_FOLDER_NAMES } from "../../constants";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput, pathVariants } from "../filter-shell-output";
import { RG_DISK_PATH } from "../ripgrep";
import { taskDir } from "../task-dir-utils";
import {
  buildWorkspaceFsLayout,
  nonTaskMounts,
  resolveReadOnlyHostPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { execShim } from "./exec-shim";
import { resolveCommandContext } from "./utils";

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

export function createRgCommand({
  attachedFolders,
  taskId,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
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
      taskHostRoot: taskDir(taskId),
    });

    const bridged = bridgePathArgs(args, layout);
    if ("error" in bridged) {
      return { exitCode: 2, stderr: `${bridged.error}\n`, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const result = await execShim(
      RG_DISK_PATH,
      [
        // ripgrep walks the real directory, so the virtual-filesystem mask over
        // the private dir does not apply. Anchored to each search root, which
        // is where the task's own private dir sits.
        "--glob",
        `!/${TASK_FOLDER_NAMES.private}/**`,
        "--path-separator=/",
        ...bridged.args,
      ],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env,
        stdin: "ignore",
      },
    );

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(
        virtualizeOutput(result.all, layout),
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
 * Rewrite the sandbox's virtual paths to the host paths ripgrep has to receive.
 *
 * Only arguments that name a mount are touched. Anything else starting with `/`
 * is left alone: it is far more likely to be a regex (`rg '/task/'`) than a
 * path, and a real absolute path is no wider a capability than the `python` and
 * `node` hatches already documented in the agent sandbox. A path that resolves
 * into the private dir, or out of its mount through a symlink, is refused.
 */
function bridgePathArgs(
  args: string[],
  layout: WorkspaceFsLayout,
): { args: string[] } | { error: string } {
  const mountPoints = [layout.task, ...nonTaskMounts(layout)].map(
    (mount) => mount.mountPoint,
  );

  const bridged: string[] = [];
  for (const arg of args) {
    const owner = mountPoints.find(
      (mountPoint) => arg === mountPoint || arg.startsWith(`${mountPoint}/`),
    );
    if (!owner) {
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
  // A single dash introduces one or more bundled short flags (`-uz`), so the
  // whole cluster has to be inspected rather than compared.
  if (/^-[a-z]+$/i.test(arg) && arg.includes(DENIED_SHORT_FLAG)) {
    return `-${DENIED_SHORT_FLAG}`;
  }
  return null;
}
