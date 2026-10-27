/**
 * Whether a script the shell runs reaches `instrument`: the channel `node`
 * and `python` open for it, the `instrument` program that says how, and the
 * lines of the prompt that name it. On unless `INSTRUMENT_SCRIPT_CHANNEL=0`,
 * which the evals' bash-only arm sets to measure the shell alone.
 */
export function scriptSurfaceOpen(): boolean {
  return process.env.INSTRUMENT_SCRIPT_CHANNEL !== "0";
}
