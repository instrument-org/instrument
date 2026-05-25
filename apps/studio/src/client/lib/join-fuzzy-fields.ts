/**
 * Joins multiple text fields into a single haystack string for uFuzzy, and
 * returns a `splitRanges` helper that maps uFuzzy ranges on the joined string
 * back to per-field ranges. Use when one fuzzy search should span several
 * fields (e.g. provider name + model name) but each field is rendered
 * separately and needs its own highlight ranges.
 */
const FIELD_SEPARATOR = " ";

export function joinFuzzyFields(fields: string[]) {
  const haystack = fields.join(FIELD_SEPARATOR);

  const bounds: { end: number; start: number }[] = [];
  let cursor = 0;
  for (const field of fields) {
    bounds.push({ end: cursor + field.length, start: cursor });
    cursor += field.length + FIELD_SEPARATOR.length;
  }

  function splitRanges(ranges: null | number[]): (null | number[])[] {
    if (!ranges?.length) {
      return fields.map(() => null);
    }
    return bounds.map(({ end, start }) => {
      const out: number[] = [];
      for (let i = 0; i < ranges.length; i += 2) {
        const rStart = ranges[i] ?? 0;
        const rEnd = ranges[i + 1] ?? 0;
        const clippedStart = Math.max(rStart, start);
        const clippedEnd = Math.min(rEnd, end);
        if (clippedStart < clippedEnd) {
          out.push(clippedStart - start, clippedEnd - start);
        }
      }
      return out.length > 0 ? out : null;
    });
  }

  return { haystack, splitRanges };
}
