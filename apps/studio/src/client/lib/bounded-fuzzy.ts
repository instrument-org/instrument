import uFuzzy from "@leeoniya/ufuzzy";

/**
 * Most needle terms uFuzzy matches in order. Its pattern lets any run of
 * characters sit between two terms, so an entry that has most of the terms
 * but not all of them backtracks through every way of placing them: about the
 * entry's length to the power of the term count. Four single letters against
 * a 1000-character entry take fifteen seconds where three take under a
 * tenth of one, and a pasted fifteen-segment path against a page at a sibling
 * path never returns.
 */
const MOST_FUZZY_TERMS = 3;

/**
 * uFuzzy's filter, info and sort, at a cost that stays bounded however many
 * words come in: the first terms are matched fuzzily, and each term past them
 * has to appear in the entry as typed, ignoring case.
 */
export function boundedFuzzy(options?: uFuzzy.Options) {
  const fuzzy = new uFuzzy(options);
  function bound(needle: string) {
    const terms = fuzzy.split(needle);
    return terms.length <= MOST_FUZZY_TERMS
      ? { head: needle, rest: [] }
      : {
          head: terms.slice(0, MOST_FUZZY_TERMS).join(" "),
          rest: terms.slice(MOST_FUZZY_TERMS).map((term) => term.toLowerCase()),
        };
  }
  return {
    filter(haystack: string[], needle: string): null | uFuzzy.HaystackIdxs {
      const { head, rest } = bound(needle);
      // oxlint-disable-next-line unicorn/no-array-method-this-argument
      const indexes = fuzzy.filter(haystack, head);
      if (!indexes || rest.length === 0) {
        return indexes;
      }
      return indexes.filter((index) => {
        const entry = haystack[index]?.toLowerCase() ?? "";
        return rest.every((term) => entry.includes(term));
      });
    },
    info(indexes: uFuzzy.HaystackIdxs, haystack: string[], needle: string) {
      return fuzzy.info(indexes, haystack, bound(needle).head);
    },
    sort(info: uFuzzy.Info, haystack: string[], needle: string) {
      return fuzzy.sort(info, haystack, bound(needle).head);
    },
  };
}
