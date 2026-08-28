import { type TableCopyFormat } from "./table-clipboard";

/**
 * The three destinations a table can be copied to, in the order they are
 * offered.
 *
 * The hint names where the copy is going rather than what the file extension
 * would be, because a destination is what anyone is actually choosing between.
 * Tab-separated text is not among them: it is the plain-text half of "Table"
 * and never a choice of its own, and neither is any third clipboard type --
 * `tableClipboardItem` says why.
 *
 * Apart from the menu it fills so that the surfaces offering a copy -- a
 * viewer toolbar, a grid's context menu, a table in the transcript -- cannot
 * drift into offering different words for the same thing.
 */
export const TABLE_COPY_FORMATS: {
  format: TableCopyFormat;
  hint: string;
  label: string;
}[] = [
  {
    format: "table",
    hint: "Pastes as a real table into Numbers, Notion, or a doc",
    label: "Table",
  },
  {
    format: "markdown",
    hint: "A pipe table, for an editor or a README",
    label: "Markdown",
  },
  {
    format: "csv",
    hint: "Comma-separated text, for a spreadsheet or a script",
    label: "CSV",
  },
];
