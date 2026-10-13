import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { commandLineToolsRefusal } from "../command-line-tools-env";
import { hostPathOf } from "../workspace-fs-layout";
import { isMissingDeveloperTool, pathProgramsNamed } from "./path-program";

/**
 * `which` as the shell's own `command -v` answers, so the two never
 * disagree: the program a name runs, or the bare name of one that runs
 * inside the shell. `-a` adds every other program by that name on the PATH
 * programs are looked up on. just-bash's built-in searches only the shell's
 * PATH, which names no program it runs. The one place the two part is a
 * macOS developer tool stub on a Mac without the tools: `command -v` names
 * its path, and `which` says the tool needs installing, as running it does.
 */
export function createWhichCommand(chatId: ChatId) {
  return defineCommand("which", async (args, ctx) => {
    const all = args.includes("-a");
    const names = args.filter((arg) => !arg.startsWith("-"));
    if (names.length === 0 || !ctx.exec) {
      return { exitCode: 1, stderr: "which: missing argument\n", stdout: "" };
    }
    let stdout = "";
    let stderr = "";
    for (const name of names) {
      const answer = await ctx.exec(
        `command -v '${name.replaceAll("'", `'\\''`)}'`,
        { cwd: ctx.cwd },
      );
      const runs = answer.exitCode === 0 ? answer.stdout.trim() : "";
      const candidates = [
        ...(runs ? [runs] : []),
        ...(all && !name.includes("/")
          ? (await pathProgramsNamed(chatId, name)).filter(
              (program) => program !== runs,
            )
          : []),
      ];
      // A developer tool stub on a Mac without the tools is not a program
      // that runs, so it is not one `which` finds.
      const found: string[] = [];
      let missingTool = false;
      for (const program of candidates) {
        if (
          program.startsWith("/") &&
          (await isMissingDeveloperTool(hostPathOf(program)))
        ) {
          missingTool = true;
        } else {
          found.push(program);
        }
      }
      if (found.length === 0) {
        stderr += missingTool
          ? `which: ${commandLineToolsRefusal(name)}`
          : `which: no ${name} among the shell's commands or on PATH\n`;
      }
      stdout += found.map((match) => `${match}\n`).join("");
    }
    return { exitCode: stderr ? 1 : 0, stderr, stdout };
  });
}
