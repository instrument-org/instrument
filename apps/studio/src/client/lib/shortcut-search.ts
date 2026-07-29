import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { type ShortcutDescriptor, type ShortcutId } from "@/shared/shortcuts";
import uFuzzy from "@leeoniya/ufuzzy";

export interface ShortcutMatch {
  descriptor: ShortcutDescriptor;
  id: ShortcutId;
  labelRanges: null | number[];
}

// Same matcher the command menu and skill search use, so a query behaves the
// way search does everywhere else in the app and can show what it matched.
const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * Ranks shortcuts against `query` and returns the ranges to highlight in each
 * label. The group name is part of the haystack -- "tab" should find the tab
 * shortcuts, "view" the View ones -- but only the label is highlighted, since
 * the group is already the heading the row sits under.
 *
 * An empty query keeps the given order and highlights nothing.
 */
export function matchShortcuts(
  entries: { descriptor: ShortcutDescriptor; id: ShortcutId }[],
  query: string,
): ShortcutMatch[] {
  if (!query) {
    return entries.map((entry) => ({ ...entry, labelRanges: null }));
  }

  const fields = entries.map((entry) =>
    joinFuzzyFields([entry.descriptor.label, entry.descriptor.group]),
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
    return [{ ...entry, labelRanges: labelRanges ?? null }];
  });
}
