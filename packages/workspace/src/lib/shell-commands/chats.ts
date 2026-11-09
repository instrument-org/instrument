import { CHATS_COMMAND } from "../../model-text/commands/chats-command";
import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";

export { CHATS_COMMAND } from "../../model-text/commands/chats-command";

/**
 * `instrument chats`: its subcommands are the registry's `chats.*`
 * capabilities, which organize the person's chats (their titles, archive
 * marks, stars and projects) and are the chat's alone. Reading what a chat
 * said is the records folder's, not this command's. Bare, it lists.
 */
export function createChatsCommand(scope: CapabilityScope) {
  return generatedCommand({
    bare: "list",
    name: CHATS_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${CHATS_COMMAND.name} <subcommand> ...\n\n  Every change shows the user a note in this chat, with Undo.\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: CHATS_COMMAND.word,
  });
}
