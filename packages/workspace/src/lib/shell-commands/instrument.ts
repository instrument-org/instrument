import { type Command, defineCommand } from "just-bash";

import { INSTRUMENT_COMMAND } from "./instrument-command";

/** One of `instrument`'s subcommands: its word, what it is in a line, and the command that runs it. */
export interface InstrumentSubcommand {
  command: Command;
  /** Whether `instrument` lists it; one left out still runs. */
  listed?: boolean;
  summary: string;
  word: string;
}

/**
 * `instrument`: each of Instrument's own commands as a word after it, run
 * with the rest of the arguments. A bare `instrument`, `help`, `--help` or
 * `-h` lists them; `instrument <word> help` is that command's own usage.
 *
 * Subcommands not `listed` are left out of the list.
 */
export function createInstrumentCommand({
  subcommands,
}: {
  subcommands: InstrumentSubcommand[];
}): Command {
  const name = INSTRUMENT_COMMAND.name;
  const listed = subcommands.filter((each) => each.listed !== false);
  const width = Math.max(...listed.map((each) => each.word.length));
  const usage = `Usage: ${name} <command> ...

${listed.map((each) => `  ${each.word.padEnd(width)}  ${each.summary}`).join("\n")}

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
    return {
      exitCode: 1,
      stderr: `${name}: unknown command "${word}".\n\n${usage}`,
      stdout: "",
    };
  });
}
