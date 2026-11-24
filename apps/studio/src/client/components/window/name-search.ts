import {
  compareMatches,
  type FoldedName,
  type FoldedWords,
  foldName,
  MATCH_STEPS,
  matchRank,
  matchRanges,
  NO_MATCH,
  positionOf,
  type Ranked,
  stepOf,
} from "@/shared/name-match";

/** Something the command menu or a new tab's box finds by its name. */
export type Named<T> = {
  /**
   * A second name it is found by and not shown under: a page's address, or
   * what a command acts on. A match by it counts as step `atBest` at best.
   */
  also?: { atBest?: number; name: string };
  /** The same from one launch to the next, since picks are remembered by it. */
  id: string;
  name: string;
  /** The person pinned, bookmarked or starred it. */
  pinned?: boolean;
  /** How much the person uses it (`usageOf`). */
  use?: number;
  value: T;
};

/** One thing the words found, as `compareMatches` orders it. */
export type Found<T> = Ranked & {
  entry: Named<T>;
  /** The step its shown name matched at, or `NO_MATCH` when only its second name did. */
  shownStep: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How much the person uses something, as one number for `Named.use` that is
 * higher for more: one for each time they opened it, halved for every week
 * since the last time. Something with no count is opened once.
 */
export function usageOf(
  { at, count = 1 }: { at: number; count?: number },
  now: number,
): number {
  return at <= 0 ? 0 : count * 0.5 ** (Math.max(0, now - at) / WEEK_MS);
}

const MOST_FOLDED = 20_000;
const foldedNames = new Map<string, FoldedName>();

/** A name folded for matching, kept so each is folded once across searches. */
function folded(name: string): FoldedName {
  const kept = foldedNames.get(name);
  if (kept) {
    return kept;
  }
  if (foldedNames.size >= MOST_FOLDED) {
    foldedNames.clear();
  }
  const made = foldName(name);
  foldedNames.set(name, made);
  return made;
}

/**
 * The entries the words find, best first (`compareMatches`). An entry with a
 * second name is found by the better of the two. `wrongLetter` also takes a
 * name one wrong letter away (step 5), for when nothing else was found.
 */
export function findNamed<T>(
  entries: readonly Named<T>[],
  words: FoldedWords,
  wrongLetter = false,
): Found<T>[] {
  const found: Found<T>[] = [];
  for (const entry of entries) {
    const own = matchRank(folded(entry.name), words, wrongLetter);
    const shownStep = own === NO_MATCH ? NO_MATCH : stepOf(own);
    let step = shownStep;
    let position = own === NO_MATCH ? 0 : positionOf(own);
    if (entry.also) {
      const other = matchRank(folded(entry.also.name), words, wrongLetter);
      const otherStep =
        other === NO_MATCH
          ? NO_MATCH
          : Math.max(stepOf(other), entry.also.atBest ?? 0);
      if (otherStep !== NO_MATCH && (step === NO_MATCH || otherStep < step)) {
        step = otherStep;
        position = positionOf(other);
      }
    }
    if (step === NO_MATCH) {
      continue;
    }
    found.push({
      entry,
      name: entry.name,
      pinned: entry.pinned,
      position,
      shownStep,
      step,
      use: entry.use,
    });
  }
  return found.toSorted(compareMatches);
}

/** What to draw as matched in a found thing's shown name, for `FuzzyHighlight`. */
export function rangesOf<T>(
  found: Found<T>,
  words: FoldedWords,
): null | number[] {
  return found.shownStep === NO_MATCH
    ? null
    : matchRanges(folded(found.entry.name), words, found.shownStep);
}

/**
 * The command menu's results from what each kind found, the kinds in the
 * order ties keep. One row is promoted over every section: the remembered
 * pick (`rememberedPick`) when the words still find it, or else the best
 * match of any kind when it is exact or the words start its name, a pinned
 * one first. Each section lists its kind's best `perKind` without the
 * promoted row, and the sections go by the step of their kind's best match,
 * so a kind the words start a name in sits over one that only contains them.
 */
export function orderSearch<T>({
  kinds,
  perKind,
  remembered,
}: {
  kinds: readonly { found: readonly Found<T>[]; label: string }[];
  perKind: number;
  remembered: string | undefined;
}): {
  promoted: Found<T> | undefined;
  sections: { label: string; rows: Found<T>[] }[];
} {
  const all = kinds.flatMap((kind) => kind.found);
  const promoted =
    (remembered === undefined
      ? undefined
      : all.find((found) => found.entry.id === remembered)) ??
    all
      .filter((found) => found.step <= MATCH_STEPS.startsName)
      .toSorted(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          compareMatches(a, b),
      )[0];
  const sections = kinds
    .map((kind) => ({
      label: kind.label,
      rows: kind.found.filter((found) => found !== promoted).slice(0, perKind),
      step: kind.found[0]?.step ?? NO_MATCH,
    }))
    .filter((section) => section.rows.length > 0)
    .toSorted((a, b) => a.step - b.step)
    .map(({ label, rows }) => ({ label, rows }));
  return { promoted, sections };
}
