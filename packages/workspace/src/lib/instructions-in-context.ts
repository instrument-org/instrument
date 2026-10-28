/**
 * Standing instructions as a session is given them: a topic's and a connected
 * app's alike, inlined up to a budget and cut on a paragraph break past it,
 * with the file holding them named so the rest is a read away.
 */

/** How much of one set of instructions is inlined, the budget a 1.x project had. */
export const INSTRUCTIONS_MAX = 20_000;

/**
 * The instructions, trimmed, or nothing where there are none. Past the budget
 * they end at the last paragraph break within it, and the line after says
 * where the whole of them is.
 */
export function instructionsInContext({
  file,
  instructions,
}: {
  /** The file they are in, by its path under the workspace's top level. */
  file: string;
  instructions: string | undefined;
}): string | undefined {
  const trimmed = instructions?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= INSTRUCTIONS_MAX) {
    return trimmed;
  }
  const within = trimmed.slice(0, INSTRUCTIONS_MAX);
  const lastBreak = within.lastIndexOf("\n\n");
  const kept = lastBreak > 0 ? within.slice(0, lastBreak) : within.trimEnd();
  return `${kept}\n\n[Cut off here: the rest is in ${file}.]`;
}
