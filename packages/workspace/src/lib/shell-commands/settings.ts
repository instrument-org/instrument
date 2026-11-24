import { SETTINGS_COMMAND } from "../../model-text/commands/settings-command";
import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";

/**
 * `instrument settings`: its subcommands are the registry's `settings.*`
 * capabilities. A task reads the settings; changing one is the chat's. Bare,
 * it lists.
 */
export function createSettingsCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: SETTINGS_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${SETTINGS_COMMAND.name} <subcommand> ...\n\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: SETTINGS_COMMAND.word,
  });
}
