import { fileURLToPath } from "node:url";

import { execa, type Options } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { ffmpegSubprocessEnv } from "./ffmpeg";
import { gitSubprocessEnv } from "./git";
import { inheritedEnv } from "./native-env";
import {
  launchNative,
  type NativeReach,
  wrapNativeCommand,
} from "./native-sandbox";
import { getWorkspaceConfig } from "./workspace-config";
import { workDir } from "./work-dir";

export function execaNodeForChat<
  OptionsType extends Omit<Options, "cwd"> = Omit<Options, "cwd">,
>(
  chatId: ChatId,
  file: string | URL,
  arguments_: readonly string[],
  options: OptionsType,
  cwd: AbsolutePath | undefined,
  /** What the command is held to (`chatNativeReach`). */
  reach: NativeReach | undefined,
) {
  const baseEnv = {
    ...options.env,
    ...ffmpegSubprocessEnv(options.env?.PATH),
  };
  // Seatbelt wraps the node binary itself, so execa's `node` option, which
  // would put process.execPath in front of sandbox-exec, is replaced by
  // naming it in the arguments.
  const spawned = wrapNativeCommand(
    process.execPath,
    [file instanceof URL ? fileURLToPath(file) : file, ...arguments_],
    reach ?? null,
  );
  const workingDir = cwd ?? workDir(chatId);
  // Only what a program needs of the app's own environment; see native-env.
  const env = {
    ...inheritedEnv(process.env, spawned.reach),
    ...baseEnv,
    // Covers what resolveCommandContext cannot: the user's own app processes
    // (spawn-runtime) and anything else spawned for a task. A build script
    // that shells out to `git` gets the same isolation the agent does. Takes
    // the env ffmpeg just built so both binary dirs survive on PATH.
    ...gitSubprocessEnv(baseEnv),
    ...getWorkspaceConfig().nodeExecEnv,
  };
  const launch = launchNative(spawned, { cwd: workingDir, env });
  return execa(launch.file, launch.args, {
    ...options,
    cwd: workingDir,
    extendEnv: false,
    env,
    stdin: options.input === undefined ? (options.stdin ?? "ignore") : "pipe",
    // Ensures callers can use stderr and stdout without null check
  } as unknown as OptionsType & {
    cwd: string;
    env: Record<string, string>;
  });
}
