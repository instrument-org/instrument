import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { nodeToolsEnv } from "./tool-isolation";
import { nodeBuildEnvFor } from "./tool-isolation-env";
import { chatNativeReach } from "./chat-native-reach";
import { runtimeLayout } from "./runtime-dir";
import { execaNodeForChat } from "./execa-node-for-chat";
import { filterShellOutput } from "./filter-shell-output";
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
      },
      // Don't reject so we can filter the output
      reject: false,
      ...(stdin && { input: stdin }),
    },
    cwd,
    reach,
  );
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
