import { type ByteString, EMPTY_BYTES, InMemoryFs } from "just-bash";

import { MOUNT } from "../../mount-points";
import {
  runSubcommand,
  type Subcommand,
} from "../../lib/shell-commands/subcommands";

/**
 * A subcommand as a function of its arguments, run the way its command runs
 * it but with its refusal thrown rather than printed, so a test can match it.
 */
export function subcommandRunner<Context>(
  spec: Subcommand<Context>,
  name: string,
) {
  return (
    args: string[],
    context: Context,
    stdin: ByteString = EMPTY_BYTES,
    cwd: string = MOUNT.task,
  ) =>
    runSubcommand(
      spec,
      args,
      context,
      { cwd, fs: new InMemoryFs(), stdin },
      { name },
    );
}
