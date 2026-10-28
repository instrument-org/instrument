import { type Command, defineCommand } from "just-bash";

import { INSTRUMENT_COMMAND } from "./instrument-command";

/** One of `instrument`'s subcommands: its word, what it is in a line, and the command that runs it. */
export interface InstrumentSubcommand {
  command: Command;
  summary: string;
  word: string;
}

/**
 * `instrument`: each of Instrument's own commands as a word after it, run
 * with the rest of the arguments. A bare `instrument`, `help`, `--help` or
 * `-h` lists them; `instrument <word> help` is that command's own usage.
 *
 * `missing` names the subcommands this shell leaves out (a task's has no
 * `task`), so asking for one says why rather than that it does not exist.
 */
export function createInstrumentCommand({
  missing = {},
  subcommands,
}: {
  missing?: Record<string, string>;
  subcommands: InstrumentSubcommand[];
}): Command {
  const name = INSTRUMENT_COMMAND.name;
  const width = Math.max(...subcommands.map((each) => each.word.length));
  const usage = `Usage: ${name} <command> ...

${subcommands.map((each) => `  ${each.word.padEnd(width)}  ${each.summary}`).join("\n")}

\`${name} <command> help\` prints one command's own usage.
`;
  return defineCommand(name, async (args, ctx) => {
    const [word, ...rest] = args;
    if (
      word === undefined ||
      word === "help" ||
      word === "--help" ||
      word === "-h"
    ) {
      return { exitCode: 0, stderr: "", stdout: usage };
    }
    const found = subcommands.find((each) => each.word === word);
    if (found) {
      return found.command.execute(rest, ctx);
    }
    const why = Object.hasOwn(missing, word) ? missing[word] : undefined;
    return {
      exitCode: 1,
      stderr: why
        ? `${name} ${word}: ${why}\n`
        : `${name}: unknown command "${word}".\n\n${usage}`,
      stdout: "",
    };
  });
}
