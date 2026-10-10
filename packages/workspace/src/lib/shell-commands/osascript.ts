import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
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
    "Run AppleScript (`osascript -e '...'`, or a script file) or JavaScript for Automation (`-l JavaScript`) against the apps on this Mac that publish a scripting dictionary: Mail, Notes, Music, Photos, Finder, Safari, Keynote and the like. " +
    "For Calendar, Reminders, and Contacts, use the `calendar` and `contacts` commands instead when they are listed: they are faster and read every account. " +
    "An app with no dictionary cannot be scripted this way. " +
    "macOS asks the user the first time each app is controlled, and the command waits on their answer. " +
    "Error -1743 means they declined, and only they can change it, under System Settings, Privacy & Security, Automation. " +
    "Working an app's windows through System Events (keystrokes, clicks, reading its buttons and windows) is refused: reach an app through a file it imports, its URL scheme, or its own scripting terms.",
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

/**
 * Keys pressed through System Events, which land in whatever app is in front.
 * Unlike a click, neither needs a process named first.
 */
const PRESSES_KEYS = /\b(?:keystroke|key\s*code)\b/i;

/** A process of System Events', AppleScript's `process "X"` or JXA's `processes`. */
const NAMES_A_PROCESS = /\bprocess(?:es)?\b/i;

/** What GUI scripting reads or works inside a process: its controls and windows. */
const UI_TERMS =
  /\b(?:click|perform\s*action|entire\s*contents|ui\s*elements?|menu\s*bars?|menu\s*items?|windows?|buttons?|text\s*fields?|checkbox(?:es)?)\b/i;

/** Accessibility attributes and actions (`"AXPress"`, `"AXFocused"`) by name. */
const AX_NAME = /\bAX[A-Z][a-z]+/;

/**
 * Whether a script works an app's windows through System Events: keystrokes,
 * clicks, or reading the buttons and windows of a process. Telling an app
 * itself (`tell application "Reminders"`), and asking System Events which
 * processes are running, are not.
 */
export function worksAppWindows(code: string): boolean {
  if (!/System Events/i.test(code)) {
    return false;
  }
  return (
    PRESSES_KEYS.test(code) ||
    (NAMES_A_PROCESS.test(code) && (UI_TERMS.test(code) || AX_NAME.test(code)))
  );
}

/**
 * Measured, it is the slowest way into an app and the least likely to arrive:
 * asked to recreate a user's Raycast snippets, a task spent three minutes on
 * 33 such calls and created none, then made Raycast's documented import file
 * in under forty seconds once told to. It also takes the user's screen while
 * it runs.
 */
const WORKS_APP_WINDOWS_REFUSAL =
  "osascript: refused: this script works an app's windows through System Events (keystrokes, clicks, or reading its buttons and windows). " +
  "That is slow, breaks on any change to the app's layout, and takes over the user's screen while it runs. " +
  "Reach the app another way: an import or config file it documents (search its docs for the format, build the file, and tell the user where to import it), its URL scheme, " +
  'its own scripting terms (`tell application "<App>"`, with no System Events), or the `calendar`, `contacts`, and `shortcuts` commands when they are listed. ' +
  "If your brief asked for the app's interface, the file is still the answer: make it and say why. " +
  "If the app has none of these, stop and report that.";

/**
 * The text of the script file a command runs, when it runs one: with no `-e`,
 * the first argument that is neither a flag nor a flag's value. A compiled
 * `.scpt` holds event codes rather than words, so it reads as nothing to
 * refuse; a script the task wrote out as text is read as written.
 */
async function scriptFileSource(
  args: string[],
  ctx: {
    cwd: string;
    fs: {
      readFileBuffer(path: string): Promise<Uint8Array>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<string[]> {
  if (args.includes("-e")) {
    return [];
  }
  const file = args.find(
    (arg, index) =>
      !arg.startsWith("-") &&
      args[index - 1] !== "-l" &&
      args[index - 1] !== "-s",
  );
  if (file === undefined) {
    return [];
  }
  try {
    const bytes = await ctx.fs.readFileBuffer(
      ctx.fs.resolvePath(ctx.cwd, file),
    );
    return [Buffer.from(bytes).toString("latin1")];
  } catch {
    return [];
  }
}

export function createOsascriptCommand(
  taskId: ChatId,
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
    const piped = subprocessStdin(ctx.stdin);
    const sources = [
      ...args.filter((_arg, index) => isScript[index]),
      ...(piped ? [piped.toString("latin1")] : []),
      ...(await scriptFileSource(args, ctx)),
    ];
    if (sources.some(worksAppWindows)) {
      return { exitCode: 1, stderr: WORKS_APP_WINDOWS_REFUSAL, stdout: "" };
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
