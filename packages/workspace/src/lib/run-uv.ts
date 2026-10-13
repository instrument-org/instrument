import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { filterShellOutput } from "./filter-shell-output";
import { inheritedEnv } from "./native-env";
import { withInstallerClosed } from "./native-sandbox";
import { getUvBinPath, uvSubprocessEnv } from "./uv";

export async function runUvCommand({
  args,
  cwd,
  lockfilePinned = false,
  signal,
  stdin,
  chatId,
}: {
  args: string[];
  cwd?: AbsolutePath;
  /**
   * Whether the versions come from a lockfile someone already chose them
   * in (a skill's own uv.lock), which the week-old release gate would
   * refuse to read whenever it pins a newer release.
   */
  lockfilePinned?: boolean;
  signal?: AbortSignal;
  stdin?: string;
  chatId: ChatId;
}) {
  const { UV_EXCLUDE_NEWER, ...pinnedEnv } = uvSubprocessEnv({ chatId });
  // Outside the rules, as the app's own install, but never able to open the
  // Command Line Tools installer: a build backend uv runs may clear its env.
  const spawned = withInstallerClosed(getUvBinPath(), args);
  const result = await execa(spawned.file, spawned.args, {
    all: true,
    cancelSignal: signal,
    cwd,
    env: {
      ...inheritedEnv(),
      ...(lockfilePinned ? pinnedEnv : { ...pinnedEnv, UV_EXCLUDE_NEWER }),
    },
    extendEnv: false,
    reject: false,
    ...(stdin === undefined ? { stdin: "ignore" } : { input: stdin }),
  });

  return {
    combined: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
    ),
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
  };
}
