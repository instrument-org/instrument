import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  resolveCommandContext,
  resolvePathArgs,
  unreachablePathArgError,
} from "./utils";

export const SHORTCUTS_COMMAND = {
  description:
    "Run the user's own Shortcuts on this Mac: whatever they have automated becomes something you can do. " +
    "`shortcuts list [--folder-name <folder>]` names them; `shortcuts run '<name>' [-i <file>]... [-o <file>]` runs one, with files as its input and its result written to a file. " +
    "A shortcut can do anything its steps do, including things the user sees and things that change their data, so run one only when the user asked for it or for what it plainly does.",
  name: "shortcuts",
} as const;

/** Ships with every Mac since Monterey. */
const SHORTCUTS_PATH = "/usr/bin/shortcuts";

/** The flags whose value is a file: an input to the shortcut, or where its result goes. */
const PATH_FLAGS = new Set(["-i", "--input-path", "-o", "--output-path"]);

export function createShortcutsCommand(
  taskId: ChatId,
  layout: WorkspaceFsLayout,
) {
  return defineCommand(SHORTCUTS_COMMAND.name, async (args, ctx) => {
    const [subcommand] = args;
    // Running and listing only: `view` opens the editor on the user's
    // screen and `sign` writes a signed copy, neither of which is work.
    if (subcommand !== "list" && subcommand !== "run") {
      return {
        exitCode: 1,
        stderr: `${SHORTCUTS_COMMAND.name} takes list or run (got ${subcommand ?? "nothing"}).\n`,
        stdout: "",
      };
    }
    const isPath = args.map((_arg, index) =>
      PATH_FLAGS.has(args[index - 1] ?? ""),
    );
    const unreachable = unreachablePathArgError(
      SHORTCUTS_COMMAND.name,
      args.filter((_arg, index) => isPath[index]),
      ctx.cwd,
    );
    if (unreachable !== undefined) {
      return { exitCode: 1, stderr: unreachable, stdout: "" };
    }
    const bridgedArgs = args.flatMap((arg, index) =>
      isPath[index] ? resolvePathArgs([arg], taskId, ctx) : [arg],
    );
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const result = await execShim(SHORTCUTS_PATH, bridgedArgs, {
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env,
      stdin: "ignore",
    });
    return {
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, SHORTCUTS_COMMAND.name), (text) =>
        filterShellOutput(text, layout),
      ),
    };
  });
}
