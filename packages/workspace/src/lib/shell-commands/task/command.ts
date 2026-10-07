import { defineCommand } from "just-bash";

import { type OneAgentMode } from "../../../types";
import {
  BACKGROUND_COMMAND_NAME,
  forkCommandName,
  inForkWords,
  isForkOnly,
  oneAgentMode,
} from "../../one-agent";
import { defineSubcommands } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { appSubcommand } from "./app";
import { type TaskCommandContext } from "./context";
import { folderSubcommand, forkOnlyFolderSubcommand } from "./folder";
import {
  foregroundNewSubcommand,
  forkOnlyNewSubcommand,
  forkSubcommand,
} from "./fork";
import { listSubcommand } from "./list";
import { logSubcommand } from "./log";
import { newSubcommand } from "./new";
import { renameSubcommand } from "./rename";
import { searchSubcommand } from "./search";
import { sendSubcommand } from "./send";
import { showSubcommand } from "./show";
import { stopSubcommand } from "./stop";
import { tabSubcommand } from "./tab";
import { trashSubcommand } from "./trash";
import { wakeSubcommand } from "./wake";

/**
 * The conversation's way of starting, steering and reading its tasks, one
 * module per subcommand under this folder. Under the one agent, `new` is the
 * fork (`fork` beside it, as an alias) or, with no background at all,
 * refused; otherwise it briefs a task.
 */
function taskCommandFor(mode: OneAgentMode | undefined) {
  if (isForkOnly(mode)) {
    return forkOnlyCommand();
  }
  const startSubcommand =
    mode === "fork"
      ? forkSubcommand
      : mode === "foreground"
        ? foregroundNewSubcommand
        : newSubcommand;
  const usage = `Usage: ${TASK_COMMAND.name} <subcommand> ...

${[
  startSubcommand,
  sendSubcommand,
  stopSubcommand,
  folderSubcommand,
  appSubcommand,
  tabSubcommand,
  listSubcommand,
  searchSubcommand,
  showSubcommand,
  logSubcommand,
  wakeSubcommand,
  renameSubcommand,
  trashSubcommand,
]
  .map((spec) => spec.usage)
  .join("")}`;

  return defineSubcommands<TaskCommandContext>({
    name: TASK_COMMAND.name,
    subcommands: {
      app: appSubcommand,
      folder: folderSubcommand,
      ...(mode === "fork" ? { fork: forkSubcommand } : {}),
      list: listSubcommand,
      log: logSubcommand,
      new: startSubcommand,
      rename: renameSubcommand,
      search: searchSubcommand,
      send: sendSubcommand,
      show: showSubcommand,
      stop: stopSubcommand,
      tab: tabSubcommand,
      trash: trashSubcommand,
      wake: wakeSubcommand,
    },
    usage,
  });
}

/**
 * The command under the fork-only modes, where every task is a fork of the
 * chat: start one, message it, stop it, read it, and give the chat a folder
 * inside one it reaches, which every fork started after has too. Its usage
 * and what it prints are in the mode's words (`inForkWords`), but for a
 * transcript, which is the fork's own.
 */
function forkOnlyCommand() {
  const name = forkCommandName();
  const subcommands = {
    new: forkOnlyNewSubcommand(),
    send: sendSubcommand,
    stop: stopSubcommand,
    list: listSubcommand,
    show: showSubcommand,
    log: logSubcommand,
    folder: forkOnlyFolderSubcommand(),
  };
  const run = defineSubcommands<TaskCommandContext>({
    name,
    subcommands,
    usage: inForkWords(
      `Usage: ${name} <subcommand> ...\n\n${Object.values(subcommands)
        .map((spec) => spec.usage)
        .join("")}`,
    ),
  });
  return async (
    args: string[],
    context: TaskCommandContext,
    shell: Parameters<typeof run>[2],
  ) => {
    const result = await run(args, context, shell);
    return args[0] === "log"
      ? result
      : {
          ...result,
          stderr: inForkWords(result.stderr),
          stdout: inForkWords(result.stdout),
        };
  };
}

export function createTaskCommand(context: TaskCommandContext) {
  // The mode is read when the command runs, on the thread that holds the
  // workspace's flags: the bash worker builds this shell too, and stands the
  // command in with a call back here.
  return defineCommand(TASK_COMMAND.name, (args, ctx) =>
    taskCommandFor(oneAgentMode())(args, context, ctx),
  );
}

/**
 * The `background` command: the `background` mode's name for the fork-only
 * `task` command, the same subcommands under the word the agent is given for
 * them. In every other mode it is not there to run.
 */
export function createBackgroundCommand(context: TaskCommandContext) {
  return defineCommand(BACKGROUND_COMMAND_NAME, async (args, ctx) => {
    const mode = oneAgentMode();
    if (mode !== "background") {
      return {
        exitCode: 127,
        stderr: `bash: ${BACKGROUND_COMMAND_NAME}: command not found\n`,
        stdout: "",
      };
    }
    return await taskCommandFor(mode)(args, context, ctx);
  });
}
