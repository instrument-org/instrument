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
 * A turn with matches the transcript holds but draws as a box, being far from
 * view, and how many drawn matches come before it.
 */
export interface BoxedMatches {
  before: number;
  turn: TurnMatches;
}

/**
 * Where a step of the find goes: to a match drawn, by its place among those;
 * to a turn drawn as a box, which is drawn and then its first or last match
 * picked; or to a turn not loaded yet, which is loaded and then the match
 * picked among those drawn: the first of all, the last of all, or the last
 * one above where the find stood.
 */
export type FindStep =
  | { index: number; kind: "drawn" }
  | { kind: "draw"; pick: "first" | "last"; turn: TurnMatches }
  | { kind: "load"; pick: "before" | "first" | "last"; turn: TurnMatches }
  | { kind: "none" };

/**
 * The next or previous match from `active` (a place among the `drawn`
 * matches), with the matches of turns not loaded yet standing above all the
 * rest, those of turns drawn as boxes between the drawn ones where they are
 * (`boxed`, in order), and the last wrapping round to the first as a
 * browser's find does.
 */
export function stepFind({
  active,
  boxed = [],
  drawn,
  forward,
  unloaded,
}: {
  active: number;
  boxed?: readonly BoxedMatches[];
  drawn: number;
  forward: boolean;
  unloaded: readonly TurnMatches[];
}): FindStep {
  const oldest = unloaded[0];
  const newest = unloaded.at(-1);
  const boxesAt = (before: number) =>
    boxed.filter((box) => box.before === before);
  const draw = (box: BoxedMatches | undefined, pick: "first" | "last") =>
    box && ({ kind: "draw", pick, turn: box.turn } as const);
  if (drawn === 0) {
    if (forward) {
      return oldest
        ? { kind: "load", pick: "first", turn: oldest }
        : (draw(boxed[0], "first") ?? { kind: "none" });
    }
    return (
      draw(boxed.at(-1), "last") ??
      (newest ? { kind: "load", pick: "last", turn: newest } : { kind: "none" })
    );
  }
  if (forward) {
    const next = draw(boxesAt(active + 1)[0], "first");
    if (next) {
      return next;
    }
    if (active < drawn - 1) {
      return { index: active + 1, kind: "drawn" };
    }
    return oldest
      ? { kind: "load", pick: "first", turn: oldest }
      : (draw(boxesAt(0)[0], "first") ?? { index: 0, kind: "drawn" });
  }
  const previous = draw(boxesAt(Math.min(active, drawn - 1)).at(-1), "last");
  if (previous) {
    return previous;
  }
  if (active > 0) {
    return { index: Math.min(active, drawn) - 1, kind: "drawn" };
  }
  return newest
    ? { kind: "load", pick: "before", turn: newest }
    : (draw(boxesAt(drawn).at(-1), "last") ?? {
        index: drawn - 1,
        kind: "drawn",
      });
}

/**
 * How the readout counts: every match, the ones not loaded first, then those
 * drawn and those in boxes in the order they stand.
 */
export function findReadout({
  active,
  boxed = [],
  drawn,
  unloaded,
}: {
  active: number;
  boxed?: readonly BoxedMatches[];
  drawn: number;
  unloaded: readonly TurnMatches[];
}): { activeMatch: number; matchCount: number } {
  const above = unloaded.reduce((sum, turn) => sum + turn.count, 0);
  const at = Math.min(active, drawn - 1);
  const boxedAbove = boxed
    .filter((box) => box.before <= at)
    .reduce((sum, box) => sum + box.turn.count, 0);
  const inBoxes = boxed.reduce((sum, box) => sum + box.turn.count, 0);
  return {
    activeMatch: drawn === 0 ? 0 : above + boxedAbove + at + 1,
    matchCount: above + inBoxes + drawn,
  };
}
