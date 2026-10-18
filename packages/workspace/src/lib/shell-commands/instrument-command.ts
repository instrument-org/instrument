/**
 * The name of the command Instrument's own commands are subcommands of
 * (`instrument task`, `instrument memory`, ...), kept apart from the command
 * itself so each subcommand's name and prompt text can be spelled from it
 * without importing the workspace machinery the command runs against.
 *
 * One namespace, because any other program on the computer's PATH also runs
 * in the shell, and a product name at the top level (`chat`, `task`) hides
 * the real program by that name.
 */
export const INSTRUMENT_COMMAND = {
  name: "instrument",
} as const;
