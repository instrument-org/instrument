const startsWithPipe = (line: string | undefined) =>
  line !== undefined && /^\s*\|/.test(line);

// A row of nothing but what a table's second row is written with.
const DELIMITER_SO_FAR = /^\s*\|[\s:|-]*$/;

const FENCE_OPENER = /^\s*(?:`{3,}|~{3,})/;

/** How many cells a row has, counting the pipes no backslash escapes. */
const cellCount = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).length;

/** How many of a delimiter row's cells have their dash. */
const dashedCellCount = (row: string) =>
  row.split("|").filter((cell) => cell.includes("-")).length;

/**
 * The block of a message still arriving, without the rows it ends on when
 * they may be the start of a table that is not one yet.
 *
 * A table is its first row and a second of dashes with as many cells. Until
 * that second row has them, Markdown reads the first as a paragraph of literal
 * pipes, which the table then replaces. So a last row that opens with a pipe
 * waits for the row under it, and the two wait together while the second is
 * still short of cells. A second row that is not dashes ends the wait, since
 * no table is coming.
 */
export function withoutArrivingTableHead(block: string): string {
  if (!block.includes("|") || FENCE_OPENER.test(block)) {
    return block;
  }
  const lines = block.split("\n");
  const endsLine = lines.at(-1) === "";
  const last = lines.length - (endsLine ? 2 : 1);
  if (!startsWithPipe(lines[last])) {
    return block;
  }
  const without = (rows: number) => lines.slice(0, last + 1 - rows).join("\n");

  if (!startsWithPipe(lines[last - 1])) {
    return without(1);
  }
  const head = lines[last - 1] ?? "";
  const second = lines[last] ?? "";
  if (
    !endsLine &&
    !startsWithPipe(lines[last - 2]) &&
    DELIMITER_SO_FAR.test(second) &&
    dashedCellCount(second) < cellCount(head)
  ) {
    return without(2);
  }
  return block;
}
