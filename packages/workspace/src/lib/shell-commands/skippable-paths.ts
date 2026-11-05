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
 * `args` with the refused paths taken out, or nothing when the search should
 * be refused whole: a refusal it cannot go without, or no path left, where the
 * program would walk the working folder instead. `refused` and `skippable`
 * count from `offset` in `args`.
 */
export function withoutRefused(
  args: readonly string[],
  refused: readonly number[],
  skippable: ReadonlySet<number>,
  offset = 0,
): string[] | undefined {
  if (
    refused.length >= skippable.size ||
    refused.some((at) => !skippable.has(at))
  ) {
    return undefined;
  }
  const out = new Set(refused.map((at) => at + offset));
  return args.filter((_, at) => !out.has(at));
}
