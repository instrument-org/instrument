import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { MEMORY_COMMAND } from "./memory-command";

export { MEMORY_COMMAND } from "./memory-command";

/**
 * `instrument memory`: its subcommands are the registry's `memory.*`
 * capabilities. A command rather than a file the agent edits, because this
 * agent has no tool that writes a file's contents, on purpose, and a memory
 * is the one thing it should be able to keep without starting a task. A task
 * lists and reads them; saving and forgetting are the chat's. Bare, it lists.
 */
export function createMemoryCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: MEMORY_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${MEMORY_COMMAND.name} <subcommand> ...\n\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: MEMORY_COMMAND.word,
  });
}
