import { type TableCopyFormat } from "./table-clipboard";

/**
 * The formats a table can be copied as, past the default one.
 *
 * Every copy writes an HTML table as well, so the choice is only ever what the
 * plain-text half says -- which is why the default item is not in this list:
 * its label belongs to whatever is being copied ("Copy table", "Copy
 * selection"), and its text half is tab-separated, which is not a format
 * anyone asks for by name.
 *
 * These two carry no explanation on purpose. Someone reaching for Markdown or
 * CSV already knows what they are, and a line of description under each turns
 * a three-item menu into a paragraph.
 */
export const TABLE_COPY_ALTERNATES: {
  format: TableCopyFormat;
  label: string;
}[] = [
  { format: "markdown", label: "Copy as Markdown" },
  { format: "csv", label: "Copy as CSV" },
];
