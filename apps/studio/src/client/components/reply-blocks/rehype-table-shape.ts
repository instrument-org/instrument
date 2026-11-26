import { isShortCell, tableShape } from "./table-shape";

/**
 * Marks each table with what its cells say about drawing it (`tableShape`),
 * so the narrow-column forms are CSS at the block's own width
 * (`.markdown-table-frame` in globals.css):
 *
 * - each body cell its column's name as `data-label`, for a record's rows;
 * - a short cell, and a column name that is a short file chip, `data-short`,
 *   which keeps it on one line; an empty body cell `data-blank`;
 * - the table its fit and what it does under it as `data-fit` and
 *   `data-narrow`, which `MarkdownTable` puts on its frame and table;
 * - in a table that becomes records, each body cell's contents wrapped in
 *   one element, so a value of several parts stays one value beside its
 *   label, and each total row `data-total`, which draws it as one line;
 * - in a table ranked by its first column, the cell after each rank that
 *   rank as `data-rank`, which titles the record;
 * - in a label and amount table, each amount but a total's its share of the
 *   largest as `--bar`, and every cell of the amount column the room the
 *   widest amount takes as `--bar-room` and the width the labels keep to one
 *   line up to as `--label-width`, from which the column sizes the bars'
 *   track;
 * - in a table that scrolls, each first cell the width its column stays
 *   before its labels wrap as `--label-width`.
 */

// `@types/hast` is not a dependency here; this reads a handful of fields.
interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

const textOf = (node: HastNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

const elementsOf = (node: HastNode | undefined, tagName: string) =>
  (node?.children ?? []).filter(
    (child) => child.type === "element" && child.tagName === tagName,
  );

/** Whether everything in a cell is bold. */
const isBold = (cell: HastNode) => {
  const content = (cell.children ?? []).filter(
    (child) => child.type !== "text" || (child.value ?? "").trim() !== "",
  );
  return (
    content.length === 1 &&
    content[0]?.type === "element" &&
    (content[0].tagName === "strong" || content[0].tagName === "b")
  );
};

/** Whether a link goes to a file, which draws as a chip, rather than a page. */
const isFileHref = (href: string) =>
  href !== "" &&
  !href.startsWith("#") &&
  !/^(?!file:)[a-z][\w+.-]*:/i.test(href);

/** The labels of the file links in a cell. */
const chipsOf = (node: HastNode): string[] =>
  node.type === "element" && node.tagName === "a"
    ? isFileHref(
        typeof node.properties?.href === "string" ? node.properties.href : "",
      )
      ? [textOf(node).trim()]
      : []
    : (node.children ?? []).flatMap(chipsOf);

const readCell = (cell: HastNode) => ({
  bold: isBold(cell),
  chips: chipsOf(cell),
  text: textOf(cell).trim(),
});

/** Whether a cell has nothing in it, not even a picture. */
const isBlank = (cell: HastNode) =>
  (cell.children ?? []).every(
    (child) => child.type === "text" && (child.value ?? "").trim() === "",
  );

function shape(table: HastNode) {
  const head = elementsOf(table, "thead")[0];
  const headCells = elementsOf(elementsOf(head, "tr")[0], "th");
  const headRead = headCells.map(readCell);
  const rows = elementsOf(table, "tbody").flatMap((body) =>
    elementsOf(body, "tr"),
  );
  const cells = rows.map((row) => elementsOf(row, "td"));
  const read = cells.map((row) => row.map(readCell));
  const { bars, fit, labelWidth, narrow, ranks, totals } = tableShape(
    headRead,
    read,
  );

  for (const [column, cell] of headCells.entries()) {
    const { chips = [], text = "" } = headRead[column] ?? {};
    if (chips.length > 0 && isShortCell(text)) {
      cell.properties = { ...cell.properties, dataShort: "" };
    }
  }

  if (fit !== undefined) {
    table.properties = {
      ...table.properties,
      dataFit: fit,
      dataNarrow: narrow,
    };
  }
  const labelStyle =
    labelWidth === undefined ? undefined : `--label-width: ${labelWidth}ch`;
  // With bars the amount column sizes itself from the labels' width; without
  // them the first column is the one held to it.
  const amountStyle =
    bars && labelStyle
      ? `--bar-room: ${bars.room}ch; ${labelStyle}`
      : undefined;
  if (labelStyle) {
    for (const row of [...elementsOf(head, "tr"), ...rows]) {
      const rowCells = (row.children ?? []).filter(
        (child) => child.type === "element",
      );
      const cell = amountStyle ? rowCells.at(-1) : rowCells[0];
      if (cell) {
        cell.properties = {
          ...cell.properties,
          style: amountStyle ?? labelStyle,
        };
      }
    }
  }
  for (const [index, row] of cells.entries()) {
    for (const [column, cell] of row.entries()) {
      const blank = isBlank(cell);
      cell.properties = {
        ...cell.properties,
        dataLabel: headRead[column]?.text ?? "",
        ...(blank
          ? { dataBlank: "" }
          : isShortCell(read[index]?.[column]?.text ?? "")
            ? { dataShort: "" }
            : {}),
      };
      if (narrow === "records" && !blank) {
        cell.children = [
          {
            children: cell.children ?? [],
            properties: {},
            tagName: "span",
            type: "element",
          },
        ];
      }
    }
    const tr = rows[index];
    if (tr && totals?.includes(index)) {
      tr.properties = { ...tr.properties, dataTotal: "" };
    }
    const titled = row[1];
    const rank = ranks?.[index];
    if (titled && rank !== undefined) {
      titled.properties = { ...titled.properties, dataRank: rank };
    }
    const amount = row[1];
    const share = bars?.shares[index];
    if (amountStyle && amount && share !== undefined) {
      amount.properties = {
        ...amount.properties,
        dataBar: "",
        style: `--bar: ${share}; ${amountStyle}`,
      };
    }
  }
}

function walk(node: HastNode) {
  if (node.type === "element" && node.tagName === "table") {
    shape(node);
    return;
  }
  for (const child of node.children ?? []) {
    walk(child);
  }
}

export function rehypeTableShape() {
  return (tree: HastNode): void => {
    walk(tree);
  };
}
