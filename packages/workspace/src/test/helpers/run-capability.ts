import { type ByteString, EMPTY_BYTES, InMemoryFs } from "just-bash";

import { cliSubcommands } from "../../lib/capabilities/cli";
import { type CapabilityScope } from "../../lib/capabilities/context";
import { runSubcommand } from "../../lib/shell-commands/subcommands";

/**
 * One generated `instrument` subcommand as a function of its arguments, run
 * the way its command runs it but with its refusal thrown rather than
 * printed, so a test can match it.
 */
export function capabilityRunner(command: string, word: string) {
  const spec = cliSubcommands(command).subcommands[word];
  if (spec === undefined) {
    throw new Error(`no instrument ${command} ${word}`);
  }
  return (
    args: string[],
    scope: CapabilityScope,
    stdin: ByteString = EMPTY_BYTES,
    cwd: string = "/work",
  ) =>
    runSubcommand(
      spec,
      args,
      scope,
      { cwd, fs: new InMemoryFs(), stdin },
      { name: `instrument ${command} ${word}` },
    );
}
