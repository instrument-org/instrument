import { trashTask } from "../../trash-task";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { getWorkspaceConfig } from "../../workspace-config";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";

export const trashSubcommand = subcommand<TaskCommandContext>({
  positional: 1,
  run: runTrash,
  usage: `  ${TASK_COMMAND.name} trash <id>
      Move a finished task to the trash. There is no undo.
`,
});

async function runTrash(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireOwnChild(input.positional[0], context);
  const result = await trashTask({
    id: task.id,
    workspaceConfig: getWorkspaceConfig(),
    workspaceRef: getWorkspaceActorRef(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return `Moved ${task.id} ("${task.title}") to the trash.\n`;
}
