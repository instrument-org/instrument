import { boundedFuzzy } from "@/client/lib/bounded-fuzzy";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";

const fuzzy = boundedFuzzy({ intraMode: 1 });

/**
 * The items the words fuzzily match, best first, each with the highlight
 * ranges of its first field, which is the one a row shows. The other fields
 * are searched too, so an address finds a page shown by its title.
 */
export function fuzzyMatch<T>(
  items: T[],
  fieldsOf: (item: T) => string[],
  words: string,
): { item: T; ranges: null | number[] }[] {
  if (items.length === 0) {
    return [];
  }
  const joined = items.map((item) => joinFuzzyFields(fieldsOf(item)));
  const haystack = joined.map((entry) => entry.haystack);
  // oxlint-disable-next-line unicorn/no-array-method-this-argument
  const indexes = fuzzy.filter(haystack, words);
  if (!indexes || indexes.length === 0) {
    return [];
  }
  const info = fuzzy.info(indexes, haystack, words);
  const order = fuzzy.sort(info, haystack, words);
  return order.flatMap((orderIndex) => {
    const index = info.idx[orderIndex] ?? -1;
    const item = items[index];
    const fields = joined[index];
    if (item === undefined || !fields) {
      return [];
    }
    const [ranges] = fields.splitRanges(info.ranges[orderIndex] ?? null);
    return [{ item, ranges: ranges ?? null }];
  });
}
