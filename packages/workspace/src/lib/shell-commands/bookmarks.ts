import { BOOKMARKS_COMMAND } from "../../model-text/commands/bookmarks-command";
import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";

/**
 * `instrument bookmarks`: its subcommands are the registry's `bookmarks.*`
 * capabilities. The window keeps the bookmarks, so a list asks it for them
 * and a change asks it to make one, which its own store applies as the
 * person's own would be. A task lists them; changing them is the chat's.
 * Bare, it lists.
 */
export function createBookmarksCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: BOOKMARKS_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${BOOKMARKS_COMMAND.name} <subcommand> ...\n\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: BOOKMARKS_COMMAND.word,
  });
}
