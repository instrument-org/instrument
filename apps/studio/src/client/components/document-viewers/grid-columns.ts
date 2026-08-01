import { type CellValue } from "./data-grid";

// Enough rows to tell a column of numbers from a column that happens to open
// with one, without scanning a large export before first paint.
const ALIGNMENT_SAMPLE_ROWS = 50;

/**
 * Whether a column reads as numeric, for formats that carry no types of their
 * own and have to be read off their values.
 *
 * Every value that is present has to parse as a number. A single non-numeric
 * entry means the column is text that contains some digits -- an ID column of
 * `1, 2, 3, N/A` is not a measurement -- and right-aligning it would only make
 * the odd one out harder to spot.
 */
export function inferAlignment({
  index,
  rows,
}: {
  index: number;
  rows: CellValue[][];
}): "left" | "right" {
  let seen = 0;
  for (const row of rows.slice(0, ALIGNMENT_SAMPLE_ROWS)) {
    const value = row[index];
    if (value === null || value === undefined || value === "") {
      continue;
    }
    if (Number.isNaN(Number(value))) {
      return "left";
    }
    seen += 1;
  }
  return seen > 0 ? "right" : "left";
}
