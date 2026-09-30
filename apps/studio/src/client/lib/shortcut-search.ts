import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { type ShortcutGuideEntry } from "@/shared/shortcut-guide";
import uFuzzy from "@leeoniya/ufuzzy";

export interface ShortcutMatch {
  entry: ShortcutGuideEntry;
  labelRanges: null | number[];
}

// Same matcher the omnibar and skill search use, so a query behaves the way
// search does everywhere else in the app and can show what it matched.
const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * Ranks shortcuts against `query` and returns the ranges to highlight in each
 * label. The group name is part of the haystack ("tab" finds the tab
 * shortcuts, "view" the View ones), but only the label is highlighted, since
 * the group is already the heading the row sits under.
 *
 * An empty query keeps the given order and highlights nothing.
 */
export function matchShortcuts(
  entries: ShortcutGuideEntry[],
  query: string,
): ShortcutMatch[] {
  if (!query) {
    return entries.map((entry) => ({ entry, labelRanges: null }));
  }

  const fields = entries.map((entry) =>
    joinFuzzyFields([entry.label, entry.group]),
  );
  const haystack = fields.map((field) => field.haystack);
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  const indexes = fuzzy.filter(haystack, query);
  if (!indexes || indexes.length === 0) {
    return [];
  }

  const info = fuzzy.info(indexes, haystack, query);
  const order = fuzzy.sort(info, haystack, query);

  return order.flatMap((orderIdx) => {
    const index = info.idx[orderIdx] ?? -1;
    const entry = entries[index];
    const field = fields[index];
    if (!entry || !field) {
      return [];
    }
    const [labelRanges] = field.splitRanges(info.ranges[orderIdx] ?? null);
    return [{ entry, labelRanges: labelRanges ?? null }];
  });
}
