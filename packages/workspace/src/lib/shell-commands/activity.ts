import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { ACTIVITY_COMMAND } from "./activity-command";

/**
 * `instrument activity`: what the user did in the app lately, read from the
 * action log on this computer (`lib/actions/log.ts`), which the shell itself
 * cannot reach. Its one subcommand is the registry's `activity.list`, which a
 * bare command runs with its flags; a chat and its tasks read it alike.
 */
export function createActivityCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: ACTIVITY_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${ACTIVITY_COMMAND.name} [--since 30m|2h|1d] [--grep <text>] [--limit <n>]\n\n  It takes --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: ACTIVITY_COMMAND.word,
  });
}
