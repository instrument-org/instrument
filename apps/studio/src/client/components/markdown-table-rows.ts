import { type CellValue, type GridColumn } from "./document-viewers/data-grid";
import { inferAlignment } from "./document-viewers/grid-columns";

interface TableContents {
  body: string[][];
  head: string[];
}

/**
 * A rendered Markdown table, read back off the DOM.
 *
 * Reading the element rather than the mdast is what keeps this honest about
 * what the reader is looking at: a cell holding a link copies as the label they
 * can see, and anything the renderer chose not to draw is not in the copy
 * either. The cost is that inline formatting flattens to text, which is the
 * right trade for every destination a copy can land in.
 */
export function readTableContents(table: HTMLTableElement): TableContents {
  const head = [...(table.tHead?.rows[0]?.cells ?? [])].map((cell) =>
    cellText(cell),
  );
  const body = [...table.tBodies]
    .flatMap((section) => [...section.rows])
    .map((row) => [...row.cells].map((cell) => cellText(cell)));

  return { body, head };
}

/**
 * The same table as something `DataGrid` can draw.
 *
 * Alignment comes from the table's own cells where GFM set one, since a `---:`
 * in the source is the author saying which way the column reads, and is
 * inferred from the values only where they did not say.
 */
export function tableGrid(table: HTMLTableElement) {
  const { body, head } = readTableContents(table);
  const rows: CellValue[][] = body;
  const headerCells = [...(table.tHead?.rows[0]?.cells ?? [])];

  const columns: GridColumn[] = head.map((name, index) => ({
    align:
      headerCells[index]?.style.textAlign === "right"
        ? "right"
        : inferAlignment({ index, rows }),
    name,
  }));

  return { columns, rows };
}

/** Header first, which is the shape every clipboard payload wants. */
export function tableRows({ body, head }: TableContents) {
  return head.length > 0 ? [head, ...body] : body;
}

function cellText(cell: HTMLTableCellElement) {
  return cell.textContent?.trim() ?? "";
}
