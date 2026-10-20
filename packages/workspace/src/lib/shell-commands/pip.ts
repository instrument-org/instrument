import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { PYTHON_COMMAND } from "./python";
import { hostPathArgs, resolveCommandContext } from "./utils";
import { installVenvError, runUv } from "./uv";

// `pip` (and the `pip3` alias) route through `uv pip`, which installs into the
// nearest virtualenv without needing pip seeded into it. `uv pip` honors
// VIRTUAL_ENV, set by the uv env overlay.
export const PIP_COMMAND = {
  description: `Install Python packages via uv into the nearest \`.venv\` up to your work folder, which the first install makes at its root, and where \`${PYTHON_COMMAND.name}\` runs. Use like pip, e.g. \`pip install <package>\`.`,
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
  const command = defineCommand(name, async (args, ctx) => {
    // `uv pip --version` is not a valid uv subcommand; intercept and return a
    // pip-compatible version string so agents that probe with `pip --version`
    // get a useful response rather than a confusing uv usage error.
    if (args[0] === "--version" || args[0] === "-V") {
      const { env, hostCwd } = resolveCommandContext(chatId, ctx);
      const uvResult = await runUv({
        args: ["--version"],
        // Its output is read here, so it never goes on to the next stage.
        ctx: { signal: ctx.signal, stdin: ctx.stdin },
        env,
        hostCwd,
      });
      const uvVersion = uvResult.stdout.trim();
      return {
        exitCode: 0,
        stderr: "",
        stdout: `pip (via uv; ${uvVersion}) from .venv\n`,
      };
    }

    const venvError = await installVenvError({ chatId, ctx });
    if (venvError !== undefined) {
      return { exitCode: 1, stderr: venvError, stdout: "" };
    }

    // After the venv is there, so the overlay points `uv pip` at it.
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    return runUv({
      args: ["pip", ...hostPathArgs(args)],
      ctx,
      env,
      hostCwd,
    });
  });
  return { ...command, acceptsPipeHandoff: true };
}
