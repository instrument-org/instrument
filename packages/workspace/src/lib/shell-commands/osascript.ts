import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
  unreachablePathArgError,
} from "./utils";

export const OSASCRIPT_COMMAND = {
  description:
    "Run AppleScript (`osascript -e '...'`, or a script file) or JavaScript for Automation (`-l JavaScript`) to work with the apps on this Mac: Reminders, Calendar, Notes, Contacts, Music, Finder and the rest. " +
    "macOS asks the user the first time each app is controlled, and the command waits on their answer. " +
    "Error -1743 means they declined, and only they can change it, under System Settings, Privacy & Security, Automation.",
  name: "osascript",
} as const;

/**
 * Where macOS keeps it. Not bundled: it ships with every Mac, and the Apple
 * Events it sends are attributed to the app, which is what the system asks the
 * user about.
 */
const OSASCRIPT_PATH = "/usr/bin/osascript";

export function createOsascriptCommand(taskId: TaskId) {
  return defineCommand(OSASCRIPT_COMMAND.name, async (args, ctx) => {
    const unreachable = unreachablePathArgError(
      OSASCRIPT_COMMAND.name,
      args,
      ctx.cwd,
    );
    if (unreachable !== undefined) {
      return { exitCode: 1, stderr: unreachable, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const stdin = subprocessStdin(ctx.stdin);

    const result = await execShim(
      OSASCRIPT_PATH,
      resolvePathArgs(args, taskId, ctx),
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
        },
        // A script piped in (`osascript - <<'EOF'`) is read from stdin; with
        // nothing piped, an ignored stdin keeps a bare `osascript` from waiting.
        ...(stdin ? { input: stdin } : { stdin: "ignore" }),
      },
    );

    const streams = mapStreams(
      shimOutput(result, OSASCRIPT_COMMAND.name),
      (text) => filterShellOutput(text, taskDir(taskId)),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}
