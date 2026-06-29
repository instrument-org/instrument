import { execa } from "execa";
import { type CommandContext, defineCommand, latin1FromBytes } from "just-bash";
import { existsSync } from "node:fs";

import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import {
  getUvBinPath,
  MANAGED_PYTHON_VERSION,
  taskVenvDir,
  taskVenvPython,
} from "../uv";
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

    // `uv pip` requires the venv to exist (VIRTUAL_ENV points at work/.venv).
    // Ensure it here so `uv pip install` works even before any `python`/`pip`
    // call has run, matching the behavior of the `pip` custom command.
    if (args[0] === "pip") {
      const venvError = await ensureTaskVenv({ ctx, env, taskCwd, taskId });
      if (venvError !== undefined) {
        return { exitCode: 1, stderr: "", stdout: venvError };
      }
    }

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
    args: ["venv", "--python", MANAGED_PYTHON_VERSION, taskVenvDir(taskId)],
    ctx,
    env,
    taskCwd,
    taskId,
  })
    .then(async (result) => {
      if (result.exitCode !== 0) {
        return result.stdout;
      }
      await seedTaskVenv({ ctx, env, taskCwd, taskId });
      return;
    })
    .finally(() => inFlightVenvCreation.delete(taskId));

  inFlightVenvCreation.set(taskId, creation);
  return creation;
}

// cspell:ignore dateutil pyyaml lxml openpyxl beautifulsoup dotenv httpx pytz numpy tqdm
// Packages pre-installed into every task venv so the agent can run common small
// scripts (HTTP, HTML/XML, dates, config, spreadsheets, images, tabular data,
// charts) without an explicit `pip install` first. This mirrors the baseline
// that code-interpreter sandboxes (OpenAI Code Interpreter, e2b, etc.) ship.
//
// Scope: moderate-or-smaller wheels only. We deliberately exclude the heavy
// stacks (torch, tensorflow, transformers, opencv-python, scipy, scikit-learn,
// spacy, nltk) -- the agent installs those on demand. numpy/pandas/matplotlib
// are included because they're the most-reached-for "small script" libraries
// and are not large.
//
// Cost: the wheels download once per machine into the shared UV_CACHE_DIR; every
// later task seeds from that cache and uv clones/hardlinks the files into the
// task venv, so per-task seeding is fast, offline, and cheap on disk.
export const SEED_PACKAGES = [
  "beautifulsoup4",
  "httpx",
  "lxml",
  "matplotlib",
  "numpy",
  "openpyxl",
  "pandas",
  "pillow",
  "python-dateutil",
  "python-dotenv",
  "pytz",
  "pyyaml",
  "requests",
  "tqdm",
] as const;

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

/**
 * Best-effort install of {@link SEED_PACKAGES} into a freshly created venv. A
 * failure here (e.g. transient network on the very first task before the wheel
 * cache is warm) must not block Python usage, so the uv result is ignored; the
 * agent can still `pip install` whatever it needs.
 */
async function seedTaskVenv({
  ctx,
  env,
  taskCwd,
  taskId,
}: {
  ctx: CommandContext;
  env: Record<string, string>;
  taskCwd: AbsolutePath;
  taskId: TaskId;
}): Promise<void> {
  await runUv({
    args: ["pip", "install", ...SEED_PACKAGES],
    ctx,
    env,
    taskCwd,
    taskId,
  });
}
