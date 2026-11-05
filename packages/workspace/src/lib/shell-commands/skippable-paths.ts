/**
 * Where in a search's arguments are paths it can go without when one of them
 * is refused: the bare words at the end of the line, past the first, which may
 * be the pattern or a flag's value. A line that mixes its flags in after its
 * paths offers none, and is refused whole. This needs no table of the flags
 * that take a value, since none can sit inside that run.
 */
export function skippablePaths(args: readonly string[]): Set<number> {
  let first = args.length;
  while (first > 0 && !(args[first - 1] ?? "").startsWith("-")) {
    first -= 1;
  }
  const skippable = new Set<number>();
  for (let at = first + 1; at < args.length; at += 1) {
    skippable.add(at);
  }
  return skippable;
}

/**
 * Whether a search still has somewhere to look once its refused paths are out:
 * one of the other words it could go without names something on disk. A word
 * may instead be the pattern, in `rg -A 3 needle ~/.ssh`, where nothing is left
 * and the program would walk the working folder.
 */
export function leavesAPath(
  operands: readonly string[],
  refused: readonly number[],
  skippable: ReadonlySet<number>,
  isPath: (operand: string) => boolean,
): boolean {
  return [...skippable].some(
    (at) => !refused.includes(at) && isPath(operands[at] ?? ""),
  );
}
