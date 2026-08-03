/**
 * Clipboard payloads for tabular selections, shared by every viewer that can
 * put cells on the clipboard.
 *
 * Both formats always go together. A spreadsheet pastes the HTML as real cells,
 * and everything else falls back to the tab-separated text, so writing only one
 * of them makes the paste worse in whichever app the reader happened to pick.
 *
 * The types are deliberately limited to these two. Chromium's async clipboard
 * rejects the entire write when handed a type outside its permitted set, so an
 * extra "richer" format does not degrade, it takes the whole copy down with it.
 */
export function tableClipboardItem(rows: string[][]) {
  return new ClipboardItem({
    "text/html": new Blob([toHtmlTable(rows)], { type: "text/html" }),
    "text/plain": new Blob([toTabSeparated(rows)], { type: "text/plain" }),
  });
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

export function toTabSeparated(rows: string[][]) {
  // Tabs and newlines inside a cell would forge a column or row boundary in a
  // format that has no way to quote them, so they become spaces.
  return rows
    .map((row) => row.map((cell) => cell.replaceAll(/[\t\n\r]/g, " ")).join("\t"))
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
