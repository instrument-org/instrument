import { defineCommand } from "just-bash";

import { defineSubcommands } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { type TaskCommandContext } from "./context";
import { folderSubcommand } from "./folder";
import { newSubcommand } from "./fork";
import { listSubcommand } from "./list";
import { logSubcommand } from "./log";
import { sendSubcommand } from "./send";
import { showSubcommand } from "./show";
import { stopSubcommand } from "./stop";

/**
 * The chat's way of starting, steering and reading its tasks, one module per
 * subcommand under this folder. Every task it starts is a fork of the chat
 * (`new`, in `fork.ts`); `folder` gives the chat a folder that its running
 * forks reach too.
 */
const subcommands = {
  new: newSubcommand,
  send: sendSubcommand,
  stop: stopSubcommand,
  list: listSubcommand,
  show: showSubcommand,
  log: logSubcommand,
  folder: folderSubcommand,
};

const runTaskCommand = defineSubcommands<TaskCommandContext>({
  name: TASK_COMMAND.name,
  subcommands,
  usage: `Usage: ${TASK_COMMAND.name} <subcommand> ...\n\n${Object.values(
    subcommands,
  )
    .map((spec) => spec.usage)
    .join("")}`,
});

export function createTaskCommand(context: TaskCommandContext) {
  return defineCommand(TASK_COMMAND.name, (args, ctx) =>
    runTaskCommand(args, context, ctx),
  );
}
