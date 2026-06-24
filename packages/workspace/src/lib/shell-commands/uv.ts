import { execa } from "execa";
import { type CommandContext, defineCommand, latin1FromBytes } from "just-bash";
import { existsSync } from "node:fs";

import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getUvBinPath, taskVenvDir, taskVenvPython } from "../uv";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const UV_COMMAND = {
  description:
    "Python package and environment manager. Also provides `python`, `python3`, and `pip`, backed by a per-task virtualenv in work/.venv. The very first Python use fetches a managed interpreter (one-time); later uses are fast.",
  name: "uv",
} as const;

export function createUvCommand(taskId: TaskId) {
  return defineCommand(UV_COMMAND.name, async (args, ctx) => {
    const blocked = blockedSelfUpdate(args);
    if (blocked) {
      return blocked;
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const result = await runUv({
      args: resolvePathArgs(args, taskId, ctx),
      ctx,
      env,
      taskCwd,
      taskId,
    });
    return { exitCode: result.exitCode, stderr: "", stdout: result.stdout };
  });
}

// Deduplicate concurrent venv creation per task. Tool calls within a session run
// sequentially, but multiple sessions/agents in the same task share work/.venv
// and can race two `uv venv` runs on the same dir, corrupting it. Keyed by taskId
// (module-level, so it spans sessions in the single workspace process); cleared
// once creation settles.
const inFlightVenvCreation = new Map<TaskId, Promise<string | undefined>>();

/**
 * Create the task's `work/.venv` if it does not yet have a usable interpreter.
 * Returns the uv output when creation fails (so callers can surface it) or
 * `undefined` on success. The first call (machine-wide) downloads a managed
 * CPython, so it can take a few seconds.
 */
export async function ensureTaskVenv({
  ctx,
  env,
  taskCwd,
  taskId,
}: {
  ctx: CommandContext;
  env: Record<string, string>;
  taskCwd: AbsolutePath;
  taskId: TaskId;
}): Promise<string | undefined> {
  // Gate on the interpreter, not the dir: an interrupted first run (aborted
  // download, timeout) can leave work/.venv present but without a usable
  // python. A dir-only check would short-circuit forever and never repair it;
  // `uv venv` recreates the dir cleanly on the retry.
  if (existsSync(taskVenvPython(taskId))) {
    return undefined;
  }

  const existing = inFlightVenvCreation.get(taskId);
  if (existing) {
    return existing;
  }

  const creation = runUv({
    args: ["venv", taskVenvDir(taskId)],
    ctx,
    env,
    taskCwd,
    taskId,
  })
    .then((result) => (result.exitCode === 0 ? undefined : result.stdout))
    .finally(() => inFlightVenvCreation.delete(taskId));

  inFlightVenvCreation.set(taskId, creation);
  return creation;
}

/**
 * Run the bundled uv binary. `env` should already include the uv overlay (it is
 * merged into every command's env by resolveCommandContext).
 */
export async function runUv({
  args,
  ctx,
  env,
  taskCwd,
  taskId,
}: {
  args: string[];
  ctx: CommandContext;
  env: Record<string, string>;
  taskCwd: AbsolutePath;
  taskId: TaskId;
}) {
  const result = await execa(getUvBinPath(), args, {
    all: true,
    cancelSignal: ctx.signal,
    cwd: taskCwd,
    env,
    reject: false,
    ...(latin1FromBytes(ctx.stdin)
      ? { input: latin1FromBytes(ctx.stdin) }
      : { stdin: "ignore" }),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: filterShellOutput(result.all, taskDir(taskId)),
  };
}

// `uv self update` would mutate the app-managed binary; block it like pnpm
// blocks store/publish. Everything else passes through.
function blockedSelfUpdate(args: string[]) {
  if (args[0] === "self" && args[1] === "update") {
    return {
      exitCode: 1,
      stderr:
        "'uv self update' is not allowed; the bundled uv version is managed by the app.\n",
      stdout: "",
    };
  }
  return;
}
