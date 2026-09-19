import { TOOL_NAMES } from "../tools/name";
import { APP_COMMAND } from "./shell-commands/app-command";
import { CHAT_COMMAND } from "./shell-commands/chat-command";
import { MEMORY_COMMAND } from "./shell-commands/memory-command";
import { TASK_COMMAND } from "./shell-commands/task-command";

/**
 * The commands the conversation's agent runs inside its bash tool, and the
 * only names this rewrites. Each is a word the prompt uses constantly and no
 * tool is called, which is exactly the confusion being repaired.
 */
const SHELL_COMMANDS = new Set<string>([
  APP_COMMAND.name,
  CHAT_COMMAND.name,
  MEMORY_COMMAND.name,
  TASK_COMMAND.name,
]);

/**
 * A tool name is a name, so anything long enough to be a script is a script.
 * Generous: a real name is one or two words, and the failure being repaired
 * puts a whole heredoc here.
 */
const TOOL_NAME_MAX = 4000;

/**
 * Turn a shell command the model called as a tool into the bash call it meant.
 *
 * Measured on the cheap models: asked to run `memory save <name>`, a model
 * emits a tool call named `memory save` -- or, worse, one whose name is the
 * entire script, heredoc and all -- rather than a `bash` call carrying it. The
 * call fails as an unknown tool, the step is spent, and whatever the command
 * would have done never happens. The same thing was measured for `task` when
 * the first-class task tool was being weighed, at two to four wasted calls a
 * run.
 *
 * This is a repair rather than a prompt line because prompt wording did not
 * move it: sampled three times each, naming the bash tool and showing the
 * command both ways left the failure at roughly one run in three.
 *
 * Only a name whose first word is one of our commands is touched, and only
 * when the agent has a bash tool to route it to, so a model asking for a tool
 * that genuinely does not exist still hears that it does not exist.
 *
 * Returns the command to run, or undefined when the call is not this mistake.
 * The whole tool name becomes the command: a name of `memory save foo` runs
 * exactly that, which fails in the shell with the command's own usage if it is
 * malformed, and that is a better answer than "no such tool" either way.
 */
export function shellCommandFromToolName({
  availableToolNames,
  toolName,
}: {
  availableToolNames: readonly string[];
  toolName: string;
}): string | undefined {
  if (!availableToolNames.includes(TOOL_NAMES.bash)) {
    return undefined;
  }
  const command = toolName.trim();
  if (command === "" || command.length > TOOL_NAME_MAX) {
    return undefined;
  }
  const first = command.split(/\s+/)[0];
  if (first === undefined || !SHELL_COMMANDS.has(first)) {
    return undefined;
  }
  // A bare command name carries no arguments, so there is nothing to run and
  // nothing to guess: `task` alone would print usage, and `memory` alone would
  // list memories, neither of which is what the model was trying to do. Its
  // arguments went into the tool input, whose shape we cannot map onto a
  // command line. Better to let it hear that the tool does not exist.
  if (command === first) {
    return undefined;
  }
  return command;
}
