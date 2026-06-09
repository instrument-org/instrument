import { type CommandContext, defineCommand, type ExecResult } from "just-bash";
import { dedent } from "radashi";

import type { AppConfig } from "../app-config/types";

import { absolutePathJoin } from "../absolute-path-join";
import { PNPM_NAME, runPnpmCommand } from "../run-pnpm";
import { systemNote } from "../system-note";
import { createTsCommand, TS_COMMAND } from "./ts";
import { resolveCommandContext } from "./utils";

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

// Skip auto-install when the subcommand is itself a package management operation
const PACKAGE_MANAGEMENT_SUBCOMMANDS = new Set([
  "add",
  "dedupe",
  "fetch",
  "i", // short for install
  "import",
  "install",
  "install-test",
  "it", // short for install-test
  "link",
  "ln", // short for link
  "prune",
  "rb", // short for rebuild
  "rebuild",
  "remove",
  "rm", // short for remove
  "uninstall",
  "unlink",
  "up", // short for update
  "update",
]);

const DEV_OR_START = new Set(["dev", "start"]);

export function createNpxCommand(appConfig: AppConfig) {
  return createDlxAliasCommand(
    NPX_COMMAND.name,
    appConfig,
    stripNpxCompatibilityFlags,
  );
}

export function createPnpmCommand(appConfig: AppConfig) {
  const tsCommand = createTsCommand(appConfig);

  return defineCommand(PNPM_COMMAND.name, async (args, ctx) => {
    const subcommand = args[0];
    const secondArg = args[1];

    // Forward `pnpm exec tsx ...` or `pnpm tsx ...`
    // to the ts command so path sandboxing and provider env are applied correctly.
    if (subcommand === "exec" && secondArg === TS_COMMAND.name) {
      return tsCommand.execute(args.slice(2), ctx);
    }
    if (subcommand === TS_COMMAND.name) {
      return tsCommand.execute(args.slice(1), ctx);
    }

    if (
      DEV_OR_START.has(subcommand ?? "") ||
      (subcommand === "run" && DEV_OR_START.has(secondArg ?? ""))
    ) {
      const fullCmd =
        subcommand === "run"
          ? `${PNPM_COMMAND.name} run ${secondArg ?? ""}`
          : `${PNPM_COMMAND.name} ${subcommand ?? ""}`;
      return {
        exitCode: 1,
        stderr: dedent`
          '${fullCmd}' is not needed here.
          The app is already started and running in the sandboxed environment.
        `,
        stdout: "",
      };
    }

    if (subcommand === "exec") {
      return blockedSubcommand(
        "exec",
        "Use the bash tool directly to run shell commands.",
      );
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

    if (subcommand === "store") {
      return blockedSubcommand(
        "store",
        "The shared package store is managed by the sandbox and must not be modified directly.",
      );
    }

    if (subcommand === "publish" || subcommand === "pack") {
      return blockedSubcommand(
        subcommand,
        "This is a sandboxed task workspace intended for development; publishing to the npm registry is not permitted.",
      );
    }

    const hasGlobalFlag = args.some((arg) => GLOBAL_FLAGS.has(arg));
    const filteredArgs = hasGlobalFlag
      ? args.filter((arg) => !GLOBAL_FLAGS.has(arg))
      : args;

    const env = Object.fromEntries(ctx.env);

    let installOutput = "";
    if (!subcommand || !PACKAGE_MANAGEMENT_SUBCOMMANDS.has(subcommand)) {
      const installResult = await runPnpmCommand({
        appConfig,
        args: ["install"],
        env,
        signal: ctx.signal,
      });
      if (installResult.exitCode !== 0) {
        installOutput = `[auto-install failed]\n${installResult.combined}\n\n`;
      }
    }

    const cwd = absolutePathJoin(appConfig.appDir, ctx.cwd);
    const result = await runPnpmCommand({
      appConfig,
      args: filteredArgs,
      cwd,
      env,
      signal: ctx.signal,
      stdin: ctx.stdin || undefined,
    });

    let globalNote = "";
    if (hasGlobalFlag) {
      globalNote = systemNote`
        The --global / -g flag was stripped. Global installs are not supported in this environment.
        Packages must be installed locally with \`${PNPM_COMMAND.name} add <package>\`.
        The command was re-run without the flag.
      `;
    }

    return {
      exitCode: result.exitCode,
      stderr: "",
      stdout: installOutput + result.combined + globalNote,
    };
  });
}

export function createPnpxCommand(appConfig: AppConfig) {
  return createDlxAliasCommand(PNPX_COMMAND.name, appConfig);
}

export function createPnxCommand(appConfig: AppConfig) {
  return createDlxAliasCommand(PNX_COMMAND.name, appConfig);
}

function createDlxAliasCommand(
  name: string,
  appConfig: AppConfig,
  normalizeArgs = (args: string[]) => args,
) {
  return defineCommand(name, async (args, ctx) => {
    const normalizedArgs = normalizeArgs(args);
    const aliasResult = registeredCommandAlias(normalizedArgs, ctx);
    if (aliasResult) {
      return aliasResult;
    }

    const { appCwd, env } = resolveCommandContext(appConfig, ctx);
    const result = await runPnpmCommand({
      appConfig,
      args: ["dlx", ...normalizedArgs],
      cwd: appCwd,
      env,
      pnpmLogLevel: "error",
      signal: ctx.signal,
      stdin: ctx.stdin || undefined,
    });

    return {
      exitCode: result.exitCode,
      stderr: "",
      stdout: result.combined,
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
    stdin: ctx.stdin,
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
