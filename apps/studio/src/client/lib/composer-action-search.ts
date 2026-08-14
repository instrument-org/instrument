import uFuzzy from "@leeoniya/ufuzzy";

export interface ComposerActionMatch<T> {
  action: T;
  labelRanges: null | number[];
}

// The matcher the command menu, the skills and the shortcut guide all search
// with, so a query typed at the composer behaves the way one typed anywhere
// else does and can show which characters it matched.
const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * Filters composer actions against `query` and returns the ranges to highlight
 * in each label.
 *
 * Left in the order they were given rather than ranked by score, unlike the
 * skills below them: this is a short list of fixed commands whose order is
 * deliberate, and a group that reshuffles under the caret is harder to aim at
 * than one that only ever gets shorter. An empty query keeps all of them and
 * highlights nothing.
 */
export function matchComposerActions<T extends { label: string }>(
  actions: T[],
  query: string,
): ComposerActionMatch<T>[] {
  if (!query) {
    return actions.map((action) => ({ action, labelRanges: null }));
  }

  const haystack = actions.map((action) => action.label);
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  const indexes = fuzzy.filter(haystack, query);
  if (!indexes || indexes.length === 0) {
    return [];
  }

  const info = fuzzy.info(indexes, haystack, query);

  return info.idx.flatMap((index, position) => {
    const action = actions[index];
    return action
      ? [{ action, labelRanges: info.ranges[position] ?? null }]
      : [];
  });
}
