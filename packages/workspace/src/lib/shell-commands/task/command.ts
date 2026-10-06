import { defineCommand } from "just-bash";

import { type OneAgentMode } from "../../../types";
import { oneAgentMode } from "../../one-agent";
import { defineSubcommands } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { appSubcommand } from "./app";
import { type TaskCommandContext } from "./context";
import { folderSubcommand } from "./folder";
import { foregroundNewSubcommand, forkSubcommand } from "./fork";
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

export function createTaskCommand(context: TaskCommandContext) {
  // The mode is read when the command runs, on the thread that holds the
  // workspace's flags: the bash worker builds this shell too, and stands the
  // command in with a call back here.
  return defineCommand(TASK_COMMAND.name, (args, ctx) =>
    taskCommandFor(oneAgentMode())(args, context, ctx),
  );
}
