/**
 * What the plain-text half of a copy is written as. The HTML half never
 * changes, so this is only ever the question of what a paste into something
 * that cannot read HTML should land as.
 */
export type TableCopyFormat = "csv" | "markdown" | "table";

/**
 * Clipboard payloads for a table or a selection out of one, shared by every
 * surface that can put cells on the clipboard.
 *
 * Both types always go together. A spreadsheet pastes the HTML as real cells,
 * and everything else falls back to the plain text, so writing only one of them
 * makes the paste worse in whichever app the reader happened to pick.
 *
 * The types are deliberately limited to these two. Chromium's async clipboard
 * rejects the entire write when handed a type outside its permitted set, so an
 * extra "richer" one does not degrade, it takes the whole copy down with it --
 * which is also why Markdown is a choice of plain text rather than a third
 * flavor riding alongside.
 *
 * `rows` may be a promise, for a viewer whose cells live in a worker. The item
 * still has to be constructed inside the gesture that asked for the copy;
 * handing it pending blobs is what keeps the write attached to that gesture.
 */
export function tableClipboardItem(
  rows: Promise<string[][]> | string[][],
  format: TableCopyFormat = "table",
) {
  const resolved = Promise.resolve(rows);
  const toPlainText = PLAIN_TEXT[format];

  return new ClipboardItem({
    "text/html": resolved.then(
      (value) => new Blob([toHtmlTable(value)], { type: "text/html" }),
    ),
    "text/plain": resolved.then(
      (value) => new Blob([toPlainText(value)], { type: "text/plain" }),
    ),
  });
}

export function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function toHtmlTable(rows: string[][]) {
  const cells = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table>${cells}</table>`;
}

/**
 * A pipe table, padded out to the header's width so a ragged row still parses.
 * The first row is the header: a Markdown table has no way to say it has none.
 */
export function toMarkdownTable(rows: string[][]) {
  const [header, ...body] = rows;
  if (!header) {
    return "";
  }
  const line = (cells: string[]) =>
    `| ${header.map((_, index) => escapeMarkdownCell(cells[index] ?? "")).join(" | ")} |`;

  return [
    line(header),
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => line(row)),
  ].join("\n");
}

export function toTabSeparated(rows: string[][]) {
  // Tabs and newlines inside a cell would forge a column or row boundary in a
  // format that has no way to quote them, so they become spaces.
  return rows
    .map((row) =>
      row.map((cell) => cell.replaceAll(/[\t\n\r]/g, " ")).join("\t"),
    )
    .join("\n");
}

const PLAIN_TEXT: Record<TableCopyFormat, (rows: string[][]) => string> = {
  csv: toCsv,
  markdown: toMarkdownTable,
  table: toTabSeparated,
};

// CSV quotes rather than escapes, and a quote inside a quoted field doubles.
function escapeCsvCell(value: string) {
  return /["\n\r,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// A cell holding a pipe would forge a column boundary, and one holding a
// newline would forge a row; the first can be escaped, the second cannot.
function escapeMarkdownCell(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll(/[\n\r]/g, " ");
}
