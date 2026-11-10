import { type TurnMatches } from "@instrument-org/workspace/client";

/**
 * The turns with matches that the transcript has not loaded yet, oldest
 * first. A chat loads from its end, so these are all above every match
 * drawn.
 */
export function unloadedMatches(
  found: readonly TurnMatches[] | undefined,
  loaded: ReadonlySet<string>,
): TurnMatches[] {
  return (found ?? []).filter((turn) => !loaded.has(turn.id));
}

/**
 * Where a step of the find goes: to a match drawn, by its place among those,
 * or to a turn not loaded yet, which is loaded and then the match picked
 * among those drawn: the first of all, the last of all, or the last one above
 * where the find stood.
 */
export type FindStep =
  | { index: number; kind: "drawn" }
  | { kind: "load"; pick: "before" | "first" | "last"; turn: TurnMatches }
  | { kind: "none" };

/**
 * The next or previous match from `active` (a place among the `drawn`
 * matches), with the matches of turns not loaded yet standing above the drawn
 * ones, and the last wrapping round to the first as a browser's find does.
 */
export function stepFind({
  active,
  drawn,
  forward,
  unloaded,
}: {
  active: number;
  drawn: number;
  forward: boolean;
  unloaded: readonly TurnMatches[];
}): FindStep {
  const oldest = unloaded[0];
  const newest = unloaded.at(-1);
  if (drawn === 0) {
    if (!oldest || !newest) {
      return { kind: "none" };
    }
    return forward
      ? { kind: "load", pick: "first", turn: oldest }
      : { kind: "load", pick: "last", turn: newest };
  }
  if (forward) {
    if (active < drawn - 1) {
      return { index: active + 1, kind: "drawn" };
    }
    return oldest
      ? { kind: "load", pick: "first", turn: oldest }
      : { index: 0, kind: "drawn" };
  }
  if (active > 0) {
    return { index: Math.min(active, drawn) - 1, kind: "drawn" };
  }
  return newest
    ? { kind: "load", pick: "before", turn: newest }
    : { index: drawn - 1, kind: "drawn" };
}

/** How the readout counts: every match, the ones not loaded first. */
export function findReadout({
  active,
  drawn,
  unloaded,
}: {
  active: number;
  drawn: number;
  unloaded: readonly TurnMatches[];
}): { activeMatch: number; matchCount: number } {
  const above = unloaded.reduce((sum, turn) => sum + turn.count, 0);
  return {
    activeMatch: drawn === 0 ? 0 : above + Math.min(active, drawn - 1) + 1,
    matchCount: above + drawn,
  };
}
