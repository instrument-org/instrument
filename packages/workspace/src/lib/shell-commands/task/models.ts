import { listRunnableModels, modelTable } from "../../chat/models";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { type TaskCommandContext } from "./context";
import { requireOwnModelParams } from "./model-choice";

export const modelsSubcommand = subcommand<TaskCommandContext>({
  flags: ["author"],
  positional: 0,
  run: runModels,
  usage: `  ${TASK_COMMAND.name} models [--author <name>]
      Every model you can run, newest first: release date, context window, price
      in dollars per million tokens in and out, what it takes besides text, and
      tags. All of them on the provider this conversation runs on, which is the
      only provider a task of yours runs on. Long; pipe it through head or rg.
`,
});

async function runModels(input: SubcommandInput, context: TaskCommandContext) {
  const author = input.value("author")?.toLowerCase();
  const { providerConfigId } = await requireOwnModelParams(context);
  const runnable = await listRunnableModels(providerConfigId);
  const models = runnable.filter(
    (model) => author === undefined || model.author.toLowerCase() === author,
  );
  if (models.length === 0) {
    return author === undefined
      ? "No models are configured.\n"
      : `No models by ${author}. Drop --author to see every author.\n`;
  }
  return modelTable(models);
}
