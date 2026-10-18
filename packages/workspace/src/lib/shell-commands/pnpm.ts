import {
  type CommandContext,
  defineCommand,
  type ExecResult,
  latin1FromBytes,
} from "just-bash";
import { dedent } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import {
  installedProjectConfig,
  installOutside,
  installsPackages,
  outsidePlan,
  projectFolder,
} from "../pnpm-outside";
import { PNPM_NAME, runPnpmCommand } from "../run-pnpm";
import { systemNote } from "../system-note";
import { resolveCommandContext, subprocessStdin } from "./utils";

export const PNPM_COMMAND = {
  description:
    "CLI tool for managing JavaScript packages. Global installs (--global / -g) are not supported; packages must be installed locally.",
  name: PNPM_NAME,
} as const;

export const NPX_COMMAND = {
  description: "Compatibility fallback for accidental npx usage.",
  name: "npx",
} as const;

export const PNPX_COMMAND = {
  description: "Alias for pnpm dlx.",
  name: "pnpx",
} as const;

export const PNX_COMMAND = {
  description: "Alias for pnpm dlx.",
  name: "pnx",
} as const;

const GLOBAL_FLAGS = new Set(["--global", "-g"]);

/** Subcommands that run install scripts in an installed project. */
const BUILD_SUBCOMMANDS = new Set(["approve-builds", "rb", "rebuild"]);

function blockedSubcommand(
  cmd: string,
  reason: string,
): { exitCode: number; stderr: string; stdout: string } {
  return {
    exitCode: 1,
    stderr: dedent`
      '${PNPM_COMMAND.name} ${cmd}' is not allowed in this environment.
      ${reason}
    `,
    stdout: "",
  };
}

export function createNpxCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return createDlxAliasCommand(
    NPX_COMMAND.name,
    chatId,
    stripNpxCompatibilityFlags,
  );
}

export function createPnpmCommand(chatId: ChatId, layout: WorkspaceFsLayout) {
  return defineCommand(PNPM_COMMAND.name, async (args, ctx) => {
    const subcommand = args[0];

    if (subcommand === "exec") {
      // Passed through whole: a `-g` here belongs to the program it runs.
      const { env: execEnv, hostCwd } = resolveCommandContext(chatId, ctx);
      const execResult = await runPnpmCommand({
        args: ["exec", ...args.slice(1)],
        cwd: hostCwd,
        env: execEnv,
        signal: ctx.signal,
        stdin: subprocessStdin(ctx.stdin),
        chatId,
      });
      return {
        exitCode: execResult.exitCode,
        stderr: execResult.stderr,
        stdout: execResult.stdout,
      };
    }

    if (subcommand === "setup") {
      return blockedSubcommand(
        "setup",
        "Shell profile changes are not supported in a sandboxed task.",
      );
    }

    if (subcommand === "env") {
      return blockedSubcommand(
        "env",
        "The Node.js version is managed by the sandbox and cannot be changed.",
      );
    }

    const hasGlobalFlag = args.some((arg) => GLOBAL_FLAGS.has(arg));
    const filteredArgs = hasGlobalFlag
      ? args.filter((arg) => !GLOBAL_FLAGS.has(arg))
      : args;

    // The host's PATH, which the shell's own does not carry: pnpm's shims
    // call sed, uname and node from it.
    const env = {
      ...Object.fromEntries(ctx.env),
      ...(process.env.PATH && { PATH: process.env.PATH }),
    };

    // The shell's cwd as a host path.
    const { hostCwd: cwd } = resolveCommandContext(chatId, ctx);

    // An install from the registry runs outside the sandbox, which refuses
    // the links it makes on Windows; anything else runs inside it.
    const plan = outsidePlan({ args: filteredArgs, cwd, layout });
    const result = plan
      ? await installOutside({ chatId, env, plan, signal: ctx.signal })
      : await runPnpmCommand({
          args: filteredArgs,
          cwd,
          env,
          // A build reads the store its project was installed from.
          ...(BUILD_SUBCOMMANDS.has(subcommand ?? "") && {
            pnpmConfig: installedProjectConfig(projectFolder(layout, cwd)),
          }),
          signal: ctx.signal,
          stdin: subprocessStdin(ctx.stdin),
          chatId,
        });

    let globalNote = "";
    if (hasGlobalFlag) {
      globalNote = systemNote`
        The --global / -g flag was stripped. Global installs are not supported in this environment.
        Packages must be installed locally with \`${PNPM_COMMAND.name} add <package>\`.
        The command was re-run without the flag.
      `;
    }

    // An install that stayed in the sandbox, where the sandbox refuses the
    // links it makes (MXC on Windows).
    const linkNote =
      !plan &&
      result.exitCode !== 0 &&
      installsPackages(filteredArgs) &&
      /EPERM[^\n]*symlink/.test(result.stderr + result.stdout)
        ? systemNote`
            The sandbox here does not let pnpm make the links this install needs. Only installs of npm registry packages work: no file:, link:, git or workspace dependencies, pnpmfiles, or project .npmrc, and only common options (-D, -E, -O, --save-peer, --frozen-lockfile, --prod, --offline).
          `
        : "";

    return {
      exitCode: result.exitCode,
      // The stripped-flag and link notes are this wrapper's own diagnostics,
      // so they join the command's stderr rather than its output.
      stderr: result.stderr + globalNote + linkNote,
      stdout: result.stdout,
    };
  });
}

export function createPnpxCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return createDlxAliasCommand(PNPX_COMMAND.name, chatId);
}

export function createPnxCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return createDlxAliasCommand(PNX_COMMAND.name, chatId);
}

function createDlxAliasCommand(
  name: string,
  chatId: ChatId,
  normalizeArgs = (args: string[]) => args,
) {
  return defineCommand(name, async (args, ctx) => {
    const normalizedArgs = normalizeArgs(args);
    const aliasResult = registeredCommandAlias(normalizedArgs, ctx);
    if (aliasResult) {
      return aliasResult;
    }

    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const result = await runPnpmCommand({
      args: ["dlx", ...normalizedArgs],
      cwd: hostCwd,
      env,
      pnpmLogLevel: "error",
      signal: ctx.signal,
      stdin: subprocessStdin(ctx.stdin),
      chatId,
    });

    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  });
}

function isNpxCompatibilityFlag(arg: string) {
  return (
    arg === "-y" ||
    arg === "--yes" ||
    arg.startsWith("--yes=") ||
    arg === "--no-install" ||
    arg === "--ignore-existing"
  );
}

function registeredCommandAlias(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> | undefined {
  const commandName = args[0];
  if (
    !commandName ||
    commandName === PNPM_COMMAND.name ||
    commandName === NPX_COMMAND.name ||
    commandName === PNPX_COMMAND.name ||
    commandName === PNX_COMMAND.name ||
    !ctx.exec ||
    !ctx.getRegisteredCommands?.().includes(commandName)
  ) {
    return undefined;
  }

  return ctx.exec(commandName, {
    args: args.slice(1),
    cwd: ctx.cwd,
    signal: ctx.signal,
    stdin: latin1FromBytes(ctx.stdin),
  });
}

function stripNpxCompatibilityFlags(args: string[]) {
  const normalizedArgs: string[] = [];
  let foundCommand = false;

  for (const arg of args) {
    if (!foundCommand && isNpxCompatibilityFlag(arg)) {
      continue;
    }

    normalizedArgs.push(arg);

    if (!arg.startsWith("-")) {
      foundCommand = true;
    }
  }

  return normalizedArgs;
}
