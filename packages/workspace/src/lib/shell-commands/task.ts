import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { TASK_COMMAND } from "./task-command";

/**
 * `instrument task`, the chat's way of starting, steering and reading its
 * tasks: its subcommands are the registry's `task.*` capabilities, one
 * module each under `capabilities/task/`. Every task it starts is a fork of
 * the chat (`new`). A task's shell has none of them, and says so.
 */
export function createTaskCommand(scope: CapabilityScope) {
  return generatedCommand({
    name: TASK_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${TASK_COMMAND.name} <subcommand> ...\n\n${generated.join("\n")}\n`,
    word: TASK_COMMAND.word,
  });
}
