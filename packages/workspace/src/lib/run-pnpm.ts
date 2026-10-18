import { type Readable } from "node:stream";

import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { nodeToolsEnv } from "./tool-isolation";
import { nodeBuildEnvFor, nodeInstallEnvFor } from "./tool-isolation-env";
import { chatNativeReach } from "./chat-native-reach";
import { runtimeLayout } from "./runtime-dir";
import { execaNodeForChat } from "./execa-node-for-chat";
import { filterShellOutput } from "./filter-shell-output";
import { inheritedEnv } from "./native-env";
import {
  collectAndForward,
  currentShellOutputSink,
} from "./shell-commands/output-sink";
import { watchSubprocessTree } from "./subprocess-tree";
import { getWorkspaceConfig } from "./workspace-config";

export const PNPM_NAME = "pnpm";

export async function runPnpmCommand({
  args,
  buildFolders = false,
  cwd,
  env,
  pnpmConfig,
  pnpmLogLevel,
  signal,
  stdin,
  chatId,
  writable = [],
}: {
  args: string[];
  /**
   * Whether this is the app building a skill it ships, which keeps pnpm's
   * store, caches and config in the build folders rather than the chats'
   * and opens them to this command alone (the config only for reading), so
   * nothing a chat wrote reaches what it builds.
   */
  buildFolders?: boolean;
  cwd?: AbsolutePath;
  env?: Record<string, string>;
  /** pnpm settings over the app's own, as `pnpm_config_*` variables. */
  pnpmConfig?: Record<string, string>;
  /** Forwarded to pnpm as `pnpm_config_loglevel`. Only `"error"` is supported (suppresses info noise; not `silent`). */
  pnpmLogLevel?: "error";
  signal?: AbortSignal;
  /** Raw bytes; a string would be UTF-8 re-encoded by execa (see subprocessStdin). */
  stdin?: Buffer;
  chatId: ChatId;
  /**
   * Folders the command may change beyond what the chat may: a skill
   * environment the app is building for it.
   */
  writable?: AbsolutePath[];
}) {
  const sink = currentShellOutputSink();
  // A skill's install runs outside any shell call, and is held to the
  // chat's reach all the same.
  const chatReach = await chatNativeReach(chatId);
  const { runtimeDir } = getWorkspaceConfig();
  const { buildCaches, buildConfig } = runtimeLayout(runtimeDir);
  const reach = chatReach && {
    ...chatReach,
    readOnly: [...chatReach.readOnly, ...(buildFolders ? [buildConfig] : [])],
    readWrite: [
      ...chatReach.readWrite,
      ...writable,
      ...(buildFolders ? [buildCaches] : []),
    ],
  };
  const subprocess = execaNodeForChat(
    chatId,
    getWorkspaceConfig().pnpmBinPath,
    args,
    {
      all: true,
      cancelSignal: sink ? undefined : signal,
      detached: sink !== undefined && process.platform !== "win32",
      env: {
        ...env,
        // pnpm uses os.homedir() to locate its store and cache, so a HOME the
        // agent exported would record a wrong store path in .modules.yaml, and
        // the next run would see a store mismatch and try to purge
        // node_modules, which fails without a TTY
        // (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). After ...env so the
        // shell's HOME cannot override it.
        ...(process.env.HOME && { HOME: process.env.HOME }),
        // The app's own store, caches and config, never the person's.
        ...(buildFolders ? nodeBuildEnvFor(runtimeDir) : nodeToolsEnv()),
        pnpm_config_reporter: "append-only",
        ...(pnpmLogLevel === "error" ? { pnpm_config_loglevel: "error" } : {}),
        ...pnpmConfig,
      },
      // Don't reject so we can filter the output
      reject: false,
      ...(stdin && { input: stdin }),
    },
    cwd,
    reach,
  );
  return await pnpmResult(args, subprocess, signal);
}

/**
 * The app's own pnpm with no sandbox around it, for the install step
 * `pnpm-outside.ts` decided may run there. Its environment is built from
 * nothing the shell has: the variables a program needs to find itself and
 * reach the network, taken from the app's own environment, the system's
 * program folders for a PATH, and `nodeInstallEnvFor`, so nothing the agent
 * exported reaches it.
 */
export async function runPnpmOutsideSandbox({
  args,
  cwd,
  signal,
}: {
  args: string[];
  cwd: AbsolutePath;
  signal?: AbortSignal;
}) {
  const sink = currentShellOutputSink();
  const { nodeExecEnv, pnpmBinPath, runtimeDir } = getWorkspaceConfig();
  const subprocess = execa(process.execPath, [pnpmBinPath, ...args], {
    all: true,
    cancelSignal: sink ? undefined : signal,
    cwd,
    detached: sink !== undefined && process.platform !== "win32",
    env: outsidePnpmEnv({
      appEnv: process.env,
      install: nodeInstallEnvFor(runtimeDir),
      nodeExecEnv,
    }),
    extendEnv: false,
    reject: false,
    stdin: "ignore",
  });
  return await pnpmResult(args, subprocess, signal);
}

/** The whole environment of the install step outside the sandbox. */
export function outsidePnpmEnv({
  appEnv,
  install,
  nodeExecEnv,
  platform = process.platform,
}: {
  /** The app's own environment, never the shell's. */
  appEnv: NodeJS.ProcessEnv;
  /** `nodeInstallEnvFor`'s folders and settings. */
  install: Record<string, string>;
  /** What runs the app's executable as Node. */
  nodeExecEnv: Record<string, string>;
  platform?: NodeJS.Platform;
}): Record<string, string> {
  return {
    ...inheritedEnv(appEnv),
    PATH: systemPath(appEnv, platform),
    ...nodeExecEnv,
    ...install,
    pnpm_config_reporter: "append-only",
  };
}

/**
 * The system's own program folders: pnpm starts nothing from the PATH with
 * scripts off, and nothing the person or the app put first on it is looked
 * at.
 */
function systemPath(
  appEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  if (platform !== "win32") {
    return "/usr/bin:/bin:/usr/sbin:/sbin";
  }
  const root = appEnv.SystemRoot ?? appEnv.SYSTEMROOT ?? "C:\\Windows";
  return [`${root}\\System32`, root, `${root}\\System32\\Wbem`].join(";");
}

async function pnpmResult(
  args: string[],
  /** A running execa subprocess, as much of it as is read here. */
  subprocess: PromiseLike<{
    exitCode?: number;
    stderr: unknown;
    stdout: unknown;
  }> & {
    pid?: number;
    readable(options: { from: "all" }): Readable;
  },
  signal: AbortSignal | undefined,
) {
  const sink = currentShellOutputSink();
  const finishTreeTermination = sink
    ? watchSubprocessTree({ pid: subprocess.pid, signal })
    : undefined;
  // Forwarded raw: the sink redacts every chunk it is handed, so redacting here
  // too would only duplicate the work. Whole lines still matter, because that
  // redaction is line-anchored and a chunk boundary mid-line would let a
  // `password=` line through split in two.
  const streamed = sink
    ? collectAndForward(subprocess.readable({ from: "all" }), sink)
    : undefined;
  const execResult = await subprocess;
  await streamed;
  await finishTreeTermination?.();
  const clean = (text: unknown) =>
    typeof text === "string" ? filterShellOutput(text) : "";
  return {
    command: `${PNPM_NAME} ${args.join(" ")}`,
    exitCode: execResult.exitCode ?? 1,
    stderr: clean(execResult.stderr),
    stdout: clean(execResult.stdout),
  };
}
