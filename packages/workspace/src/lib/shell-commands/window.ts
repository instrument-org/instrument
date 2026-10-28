import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { WINDOW_COMMAND } from "./window-command";

/**
 * `instrument window`, what is in front of the person: the chat's tabs in
 * their window. Its subcommands are the registry's `window.*` capabilities.
 * The window keeps the tabs and does the work; each capability checks what
 * it can on this side (that a path is one the window can show, which task
 * is at work in a tab) and reports, one line per tab, what the window did.
 *
 * Every ask names the chat the command ran in, so a tab opened goes beside
 * that chat and an id is looked up among that chat's tabs. A task reads the
 * window (`list`, `read`) and changes nothing in it: the chat arranges what
 * the person sees.
 */
export function createWindowCommand(scope: CapabilityScope) {
  return generatedCommand({
    name: WINDOW_COMMAND.name,
    scope,
    usage: (generated) =>
      `Usage: ${WINDOW_COMMAND.name} <subcommand> ...\n\n  These take --json, for the result as JSON, and --out <file>, to write it there.\n${generated.join("\n")}\n`,
    word: WINDOW_COMMAND.word,
  });
}
