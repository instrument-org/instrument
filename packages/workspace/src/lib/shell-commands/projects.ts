import { PROJECTS_COMMAND } from "../../model-text/commands/projects-command";
import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";

export { PROJECTS_COMMAND } from "../../model-text/commands/projects-command";

/**
 * `instrument projects`: its subcommands are the registry's `projects.*`
 * capabilities. It only lists: a project is a folder under `Projects/`, which
 * the agent makes and changes as it does any folder. Bare, it lists.
 */
export function createProjectsCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: PROJECTS_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${PROJECTS_COMMAND.name} <subcommand> ...\n\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: PROJECTS_COMMAND.word,
  });
}
