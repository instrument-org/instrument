import { defineCommand } from "just-bash";

import { defineSubcommands } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { appSubcommand } from "./app";
import { type TaskCommandContext } from "./context";
import { folderSubcommand } from "./folder";
import { forkSubcommand } from "./fork";
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
 * module per subcommand under this folder.
 */
const USAGE = `Usage: ${TASK_COMMAND.name} <subcommand> ...

${[
  newSubcommand,
  forkSubcommand,
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

const runTask = defineSubcommands<TaskCommandContext>({
  name: TASK_COMMAND.name,
  subcommands: {
    app: appSubcommand,
    folder: folderSubcommand,
    fork: forkSubcommand,
    list: listSubcommand,
    log: logSubcommand,
    new: newSubcommand,
    rename: renameSubcommand,
    search: searchSubcommand,
    send: sendSubcommand,
    show: showSubcommand,
    stop: stopSubcommand,
    tab: tabSubcommand,
    trash: trashSubcommand,
    wake: wakeSubcommand,
  },
  usage: USAGE,
});

export function createTaskCommand(context: TaskCommandContext) {
  return defineCommand(TASK_COMMAND.name, (args, ctx) =>
    runTask(args, context, ctx),
  );
}
