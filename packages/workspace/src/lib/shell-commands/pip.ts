import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { PYTHON_COMMAND } from "./python";
import { hostPathArgs, resolveCommandContext } from "./utils";
import { ensureVenvForCommand, runUv } from "./uv";

// `pip` (and the `pip3` alias) route through `uv pip`, which installs into the
// task venv (.venv) without needing pip seeded into the env. `uv pip`
// honors VIRTUAL_ENV, set by the uv env overlay.
export const PIP_COMMAND = {
  description: `Install Python packages into the per-task virtualenv (.venv) via uv, where \`${PYTHON_COMMAND.name}\` runs. Use like pip, e.g. \`pip install <package>\`.`,
  name: "pip",
} as const;

export const PIP3_COMMAND = {
  description: "Alias for pip.",
  name: "pip3",
} as const;

export function createPip3Command(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return createPipCommandNamed(chatId, PIP3_COMMAND.name);
}

export function createPipCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return createPipCommandNamed(chatId, PIP_COMMAND.name);
}

function createPipCommandNamed(chatId: ChatId, name: string) {
  return defineCommand(name, async (args, ctx) => {
    // `uv pip --version` is not a valid uv subcommand; intercept and return a
    // pip-compatible version string so agents that probe with `pip --version`
    // get a useful response rather than a confusing uv usage error.
    if (args[0] === "--version" || args[0] === "-V") {
      const { env, taskCwd } = resolveCommandContext(chatId, ctx);
      const uvResult = await runUv({
        args: ["--version"],
        ctx,
        env,
        taskCwd,
      });
      const uvVersion = uvResult.stdout.trim();
      return {
        exitCode: 0,
        stderr: "",
        stdout: `pip (via uv; ${uvVersion}) from .venv\n`,
      };
    }

    const { env, taskCwd } = resolveCommandContext(chatId, ctx);

    const venvError = await ensureVenvForCommand({ ctx, chatId });
    if (venvError !== undefined) {
      return { exitCode: 1, stderr: venvError, stdout: "" };
    }

    return runUv({
      args: ["pip", ...hostPathArgs(args)],
      ctx,
      env,
      taskCwd,
    });
  });
}
