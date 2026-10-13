import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { createPathProgramResolver, pathProgramsNamed } from "./path-program";

/**
 * `which` over what the shell actually runs: its own commands first, by bare
 * name since they have no file of their own, then the programs on the
 * computer's PATH. just-bash's built-in searches only the shell's virtual
 * PATH, so it would miss both. `-a` lists every match rather than the first.
 */
export function createWhichCommand(
  availableCommands: Set<string>,
  chatId: ChatId,
) {
  const resolveProgram = createPathProgramResolver(chatId);
  return defineCommand("which", async (args, ctx) => {
    const all = args.includes("-a");
    const names = args.filter((arg) => !arg.startsWith("-"));
    if (names.length === 0) {
      return { exitCode: 1, stderr: "which: missing argument\n", stdout: "" };
    }
    let stdout = "";
    let stderr = "";
    for (const name of names) {
      const found = name.includes("/")
        ? (await resolveProgram(name, ctx))
          ? [name]
          : []
        : [
            ...(availableCommands.has(name) ? [name] : []),
            ...(all || !availableCommands.has(name)
              ? await pathProgramsNamed(chatId, name)
              : []),
          ];
      if (found.length === 0) {
        stderr += `which: no ${name} among the shell's commands or on PATH\n`;
      }
      stdout += (all ? found : found.slice(0, 1))
        .map((match) => `${match}\n`)
        .join("");
    }
    return { exitCode: stderr ? 1 : 0, stderr, stdout };
  });
}
