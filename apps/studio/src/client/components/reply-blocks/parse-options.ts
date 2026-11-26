import { type ParsedTable, parseTable } from "./parse-body";
import { plainTextOf } from "./plain-text";

export interface Options {
  /** Whether every option is named by a picture, which draws them side by side. */
  isPictures: boolean;
  /** The row the header picks, by its index. */
  pick?: number;
  table: ParsedTable;
}

const PICTURE = /!\[[^\]]*\]\([^)]*\)/;

/**
 * Reads an options block: a table whose first column names the options and
 * whose other columns are what they share. Undefined with no table, which the
 * block reads as "draw this as Markdown".
 */
export function parseOptions(
  body: string,
  header: Record<string, string>,
): Options | undefined {
  const table = parseTable(body);
  if (!table) {
    return undefined;
  }
  const pick = pickOf(
    table.rows.map((row) => optionName(row[0] ?? "")),
    header.pick,
  );
  return {
    isPictures:
      table.rows.length > 0 &&
      table.rows.every((row) => PICTURE.test(row[0] ?? "")),
    table,
    ...(pick === undefined ? {} : { pick }),
  };
}

/**
 * An option's name as a reader would say it: the cell's words, or for a
 * picture alone, what its alt text says.
 */
export const optionName = (cell: string) => {
  const words = plainTextOf(cell.replace(PICTURE, "")).trim();
  if (words !== "") {
    return words;
  }
  return /!\[([^\]]*)\]/.exec(cell)?.[1]?.trim() ?? "";
};

/**
 * The option the header names: the one of that name, or failing that the one
 * name that starts with or holds it ("Pinecrest" for "Pinecrest Mutual").
 */
const pickOf = (names: string[], written: string | undefined) => {
  const wanted = plainTextOf(written ?? "").toLowerCase();
  if (wanted === "") {
    return undefined;
  }
  const lower = names.map((name) => name.toLowerCase());
  const exact = lower.indexOf(wanted);
  if (exact !== -1) {
    return exact;
  }
  const near = lower.flatMap((name, index) =>
    name.startsWith(wanted) || name.includes(wanted) || wanted.includes(name)
      ? [index]
      : [],
  );
  return near.length === 1 ? near[0] : undefined;
};
