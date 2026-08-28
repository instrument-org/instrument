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

/** Header first, which is the shape every clipboard payload wants. */
export function tableRows({ body, head }: TableContents) {
  return head.length > 0 ? [head, ...body] : body;
}

function cellText(cell: HTMLTableCellElement) {
  return cell.textContent?.trim() ?? "";
}
