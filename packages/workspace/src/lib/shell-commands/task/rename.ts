import { updateTaskSettings } from "../../task-settings";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";

export const renameSubcommand = subcommand<TaskCommandContext>({
  run: runRename,
  usage: `  ${TASK_COMMAND.name} rename <id> '<title>'
      Give a task a better title.
`,
});

async function runRename(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireOwnChild(input.positional[0], context);
  const title = input.positional.slice(1).join(" ").trim();
  if (!title) {
    throw new Error("rename takes the new title after the id.");
  }
  const result = await updateTaskSettings(task.id, { name: title });
  if (result.isErr()) {
    throw result.error;
  }
  return `Renamed ${task.id} to "${title}".\n`;
}
