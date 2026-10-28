import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { X_COMMAND } from "./x-command";

export { X_COMMAND } from "./x-command";

/** `instrument x`: its subcommands are the registry's `x.*` capabilities. */
export function createXCommand(scope: CapabilityScope) {
  return generatedCommand({
    name: X_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${X_COMMAND.name} <subcommand> ...\n\n  These take --json, for the posts as JSON, and --out <file>, to write them there:\n${generated.join("\n")}\n`,
    word: X_COMMAND.word,
  });
}
