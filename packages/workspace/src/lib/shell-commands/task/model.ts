import { taskDir } from "../../task-dir-utils";
import { setTaskState } from "../../task-record";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";
import { requireOwnProvider, resolveModel } from "./model-choice";

export const modelSubcommand = subcommand<TaskCommandContext>({
  positional: 2,
  run: runModel,
  usage: `  ${TASK_COMMAND.name} model <id> <model>
      The model its next turn runs on, named author/id as \`models\` prints it.
`,
});

async function runModel(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireOwnChild(input.positional[0], context);
  const rawURI = input.positional[1];
  if (!rawURI) {
    throw new Error(
      "model: a model is required, named author/id as `models` prints it.",
    );
  }
  const { model, modelURI } = await resolveModel(rawURI, context);
  await requireOwnProvider(model, context);
  await setTaskState(taskDir(task.id), { selectedModelURI: modelURI });
  return `${task.id} will run its next turn on ${modelURI}.\n`;
}
