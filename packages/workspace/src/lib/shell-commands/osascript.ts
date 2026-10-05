import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  bridgeAppleScriptPaths,
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
  unreachablePathArgError,
} from "./utils";

export const OSASCRIPT_COMMAND = {
  description:
    "Run AppleScript (`osascript -e '...'`, or a script file) or JavaScript for Automation (`-l JavaScript`) to work with the apps on this Mac: Reminders, Calendar, Notes, Contacts, Music, Finder and the rest. " +
    "For Calendar, Reminders, and Contacts, use the `calendar` and `contacts` commands instead when they are listed: they are faster and read every account. " +
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

/**
 * Apps a script cannot reach by name, by the bundle id that reaches them.
 * Mail's own Quick Look and Share extensions register under the name "Mail",
 * so `tell application "Mail"` lands on an extension: `version` answers 16.0,
 * and every word of Mail's own (`inbox`, `account`, `message`) fails to
 * compile. Its bundle id reaches Mail itself.
 */
const ADDRESSED_BY_ID: Record<string, string> = {
  Mail: "com.apple.mail",
};

/**
 * A script with each app in `ADDRESSED_BY_ID` named by its bundle id instead:
 * AppleScript's `application "Mail"` (or `app "Mail"`) and JavaScript for
 * Automation's `Application("Mail")`. Other quoted words, such as System
 * Events' `process "Mail"`, are left alone.
 */
export function addressAppsById(code: string): string {
  let out = code;
  for (const [name, id] of Object.entries(ADDRESSED_BY_ID)) {
    out = out
      .replaceAll(
        new RegExp(String.raw`\b(app(?:lication)?)\s+"${name}"`, "g"),
        `$1 id "${id}"`,
      )
      .replaceAll(
        new RegExp(String.raw`\bApplication\(\s*(["'])${name}\1\s*\)`, "g"),
        `Application("${id}")`,
      );
  }
  return out;
}

export function createOsascriptCommand(
  taskId: TaskId,
  layout: WorkspaceFsLayout,
) {
  return defineCommand(OSASCRIPT_COMMAND.name, async (args, ctx) => {
    // The value after each `-e` is script source, not a path: it is checked
    // and bridged as code, and only the remaining arguments as paths.
    const isScript = args.map((_arg, index) => args[index - 1] === "-e");
    const unreachable = unreachablePathArgError(
      OSASCRIPT_COMMAND.name,
      args.filter((_arg, index) => !isScript[index]),
      ctx.cwd,
    );
    if (unreachable !== undefined) {
      return { exitCode: 1, stderr: unreachable, stdout: "" };
    }
    const bridgedArgs: string[] = [];
    for (const [index, arg] of args.entries()) {
      if (!isScript[index]) {
        bridgedArgs.push(...resolvePathArgs([arg], taskId, ctx));
        continue;
      }
      const bridged = bridgeAppleScriptPaths(arg, taskId);
      if ("error" in bridged) {
        return { exitCode: 1, stderr: bridged.error, stdout: "" };
      }
      bridgedArgs.push(addressAppsById(bridged.code));
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    // A script piped in is ASCII where it names an app, so the rewrite reads
    // it as the latin1 bytes it arrives as and leaves every other byte be.
    const piped = subprocessStdin(ctx.stdin);
    const stdin = piped
      ? Buffer.from(addressAppsById(piped.toString("latin1")), "latin1")
      : undefined;

    const result = await execShim(OSASCRIPT_PATH, bridgedArgs, {
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env: {
        ...getWorkspaceConfig().nodeExecEnv,
        ...env,
      },
      // A script piped in (`osascript - <<'EOF'`) is read from stdin; with
      // nothing piped, an ignored stdin keeps a bare `osascript` from waiting.
      ...(stdin ? { input: stdin } : { stdin: "ignore" }),
    });

    const streams = mapStreams(
      shimOutput(result, OSASCRIPT_COMMAND.name),
      (text) => filterShellOutput(text, layout),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}
