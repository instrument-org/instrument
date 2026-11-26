import { parseValue } from "./parse-value";
import { UNBROKEN_LABEL_MAX } from "./rehype-unbroken-inline";

/**
 * A table cell as the shape reads it: its words, whether all of them are
 * bold, and the labels of the files it links, each drawn as a chip.
 */
export interface ShapeCell {
  bold?: boolean;
  chips?: string[];
  text: string;
}

/**
 * How a plain table is drawn, decided from what it holds so the switch can be
 * CSS at the block's own width (`.markdown-table-frame[data-fit]` in
 * globals.css) with nothing measured.
 */
export interface TableShape {
  /**
   * A bar per row beside its amount, for a label column and an amount
   * column: each row's share of the largest amount, undefined for a total.
   */
  bars?: { room: number; shares: (number | undefined)[] };
  /** The block width in rem under which the table no longer reads as one. */
  fit?: number;
  /**
   * How wide, in the table's `ch`, the first column stays before its labels
   * wrap, for a table whose other columns take the rest: one with bars, or
   * one that scrolls under its fit, where the column is held.
   */
  labelWidth?: number;
  /**
   * What the table does under its fit: one record per row, for a few rows,
   * or scroll sideways with its first column held, for more.
   */
  narrow?: "records" | "scroll";
  /**
   * The rank each row's first cell gives it, when that column only numbers
   * the rows (`#`, 1 to n), so a record is titled by the column after it.
   */
  ranks?: string[];
  /**
   * The rows that sum the others, which records draw as one line rather
   * than as a record of their own.
   */
  totals?: number[];
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/u;

/**
 * About how wide a run of text sets in the table's face, in its `ch` (the
 * width of a zero), from the face's measured averages.
 */
const textWidth = (text: string, bold = false) => {
  let width = 0;
  for (const char of text) {
    width += /\d/.test(char)
      ? 1
      : /[A-Z]/.test(char)
        ? 1.1
        : /[a-z]/.test(char)
          ? 0.85
          : /[\s.,:;'’|!]/.test(char)
            ? 0.4
            : /[()[\]\-–—/]/.test(char)
              ? 0.55
              : CJK.test(char)
                ? 1.8
                : 1;
  }
  return bold ? width * 1.04 : width;
};

// A column of sentences still needs this much to read as more than a word a
// line, and a longer phrase is given at least this much before it wraps.
const PROSE_FLOOR_CH = 14;
const PHRASE_FLOOR_CH = 10;
// Cell padding between two columns, in the table's `ch`.
const COLUMN_GAP_CH = 1.8;
// What a file chip adds to its label: the icon ahead of it, its padding and
// its border.
const CHIP_CH = 3;
// The most characters a cell has and still never wraps ("Jul 8, 2026",
// "$2,400 (Aug 2)"), and the most a short aside after it adds:
// "$1,150.00 (Aug 25)", "+$14,400 (+104%)".
const SHORT_CHARS = 14;
const SHORT_ASIDE_CHARS = 10;
// The most rows a table has and still becomes records under its fit, where a
// record for each is a few to compare; past it, a record each is a long read
// and the table scrolls instead.
const RECORDS_MAX_ROWS = 6;
// The table sets at `min(1em, 0.875rem)`, where a `ch` is 0.63em.
const REM_PER_CH = 0.875 * 0.63;

// The most the first column is held open for its labels: where the table
// scrolls, so the held column leaves room for the figures; and beside bars,
// where the labels take up to this much before the bars take any, so a
// narrow block with long labels shows the amounts alone.
const SCROLL_LABEL_MAX_CH = 18;
const BARS_LABEL_MAX_CH = 30;

// The widths a table's fit is rounded up to, in rem; each has its
// container query in globals.css. Under the first, every table fits.
const FIT_TIERS = [
  12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 35, 38, 42, 46, 50, 56, 64, 72,
  80,
] as const;

const wordsOf = (text: string) =>
  text.split(CJK.test(text) ? /\s+|(?=[⺀-鿿])/u : /\s+/).filter(Boolean);

/** Whether a cell is a sentence or more, which wraps however wide its column. */
const isProse = (text: string) =>
  wordsOf(text).length >= 6 || textWidth(text) > 32;

/**
 * Whether a cell is short enough never to wrap: a number, an amount, a date
 * or a name of a few words, with a short aside in brackets after it or not.
 * A table draws it on one line wherever it is.
 */
export const isShortCell = (text: string) => {
  const trimmed = text.trim();
  const aside = /^(.*\S) (\([^()]+\))$/u.exec(trimmed);
  return aside
    ? (aside[1] ?? "").length <= SHORT_CHARS &&
        (aside[2] ?? "").length <= SHORT_ASIDE_CHARS
    : trimmed.length <= SHORT_CHARS;
};

/** The widest a run of text sets without breaking, in the table's `ch`. */
const longestWord = (text: string, bold?: boolean) =>
  Math.max(0, ...wordsOf(text).map((word) => textWidth(word, bold)));

/**
 * The narrowest a cell reads well at, in the table's `ch`: a short cell
 * whole, a sentence at least `PROSE_FLOOR_CH`, a longer phrase at least
 * `PHRASE_FLOOR_CH`, and never under its longest word. A file chip counts
 * as its label with the chip around it, whole up to `UNBROKEN_LABEL_MAX`
 * characters, as it is drawn.
 */
const cellNeed = ({ bold, chips = [], text }: ShapeCell) => {
  const whole = textWidth(text, bold) + chips.length * CHIP_CH;
  if (isShortCell(text)) {
    return whole;
  }
  const unbroken = Math.max(
    longestWord(text, bold),
    ...chips.map(
      (label) =>
        (label.length <= UNBROKEN_LABEL_MAX
          ? textWidth(label, bold)
          : longestWord(label, bold)) + CHIP_CH,
    ),
  );
  if (isProse(text)) {
    return Math.max(unbroken, PROSE_FLOOR_CH);
  }
  return Math.max(unbroken, Math.min(whole, PHRASE_FLOOR_CH));
};

/** A column name wraps between its words, but not inside a file chip. */
const headNeed = (cell: ShapeCell) =>
  cell.chips?.length
    ? cellNeed({ ...cell, bold: true })
    : longestWord(cell.text, true);

const RANK_HEADS = /^(|#|no\.?|rank|place)$/i;

/** The ranks a first column gives its rows, when it is only 1 to n. */
const ranksOf = (head: ShapeCell[], rows: ShapeCell[][]) => {
  if (head.length < 3 || !RANK_HEADS.test((head[0]?.text ?? "").trim())) {
    return undefined;
  }
  const ranks = rows.map((row) =>
    (row[0]?.text ?? "").trim().replace(/^#\s*|\.$/g, ""),
  );
  return ranks.length > 0 &&
    ranks.every((rank, index) => rank === String(index + 1))
    ? ranks
    : undefined;
};

/**
 * The width that keeps a first column's labels on one line, up to `most`,
 * with a tenth over the estimate so a label it reads a little short of does
 * not wrap its last word.
 */
const labelWidthOf = (rows: ShapeCell[][], most: number) => {
  const widest = Math.max(
    0,
    ...rows.map(
      (row) =>
        textWidth(row[0]?.text ?? "", row[0]?.bold) +
        (row[0]?.chips?.length ?? 0) * CHIP_CH,
    ),
  );
  return Number(Math.min(most, widest * 1.1).toFixed(1));
};

/** Whether a row sums the others: its label bold, or starting "Total". */
const isTotal = (row: ShapeCell[]) =>
  row[0]?.bold === true || /^total\b/i.test((row[0]?.text ?? "").trim());

const TOTAL_LABEL = /^(total|grand total|sum|all)\b/i;

/**
 * The rows that sum the others in a table of records: one labeled as a
 * total ("Total", "All 8"), or a last row whose bold label stands over empty
 * cells or bold figures alone. A bold label anywhere else marks a pick, as
 * often as not, so it is no total by itself.
 */
const totalsOf = (rows: ShapeCell[][]) =>
  rows.flatMap((row, index) => {
    const label = row[0];
    const rest = row.slice(1).filter(({ text }) => text.trim() !== "");
    const isLast = index === rows.length - 1;
    return label &&
      (TOTAL_LABEL.test(label.text.trim()) ||
        (isLast &&
          rows.length >= 3 &&
          label.bold === true &&
          (rest.length < row.length - 1 || rest.every(({ bold }) => bold))))
      ? [index]
      : [];
  });

/**
 * A bar beside each amount, for exactly a label column and an amount column
 * of three to 24 rows, every amount a number in one unit and none below zero.
 * The unit has to be written (a currency, `%`, `km`): a column of bare
 * numbers is as often years or ports or ids as it is amounts. A total row is
 * drawn without one and left out of the scale.
 */
const barsOf = (head: ShapeCell[], rows: ShapeCell[][]) => {
  if (head.length !== 2 || rows.length < 3 || rows.length > 24) {
    return undefined;
  }
  const units = new Set<string>();
  const amounts = rows.map((row) => {
    if (isTotal(row)) {
      return undefined;
    }
    const parsed = parseValue(row[1]?.text ?? "");
    if (parsed) {
      units.add(`${parsed.prefix}|${parsed.suffix}`);
    }
    return parsed?.value ?? Number.NaN;
  });
  const scaled = amounts.filter((amount) => amount !== undefined);
  const top = Math.max(...scaled);
  if (
    scaled.length < 3 ||
    units.size !== 1 ||
    units.has("|") ||
    scaled.some((amount) => Number.isNaN(amount) || amount < 0) ||
    !(top > 0)
  ) {
    return undefined;
  }
  return {
    room: Number(
      Math.max(...rows.map((row) => textWidth(row[1]?.text ?? ""))).toFixed(1),
    ),
    shares: amounts.map((amount) =>
      amount === undefined ? undefined : Number((amount / top).toFixed(4)),
    ),
  };
};

/**
 * Reads how a table is best drawn from its cells. A table of three or more
 * columns gets a fit: the narrowest block it reads well in, every column at
 * the narrowest its cells allow (`cellNeed`), rounded up to a tier. Under
 * it, a table of a few rows becomes records, a comparison whose deciding
 * column is as often as not the last, and a longer one scrolls. A total row
 * is not counted among the few.
 */
export function tableShape(head: ShapeCell[], rows: ShapeCell[][]): TableShape {
  const ranks = ranksOf(head, rows);
  const bars = barsOf(head, rows);
  const shape: TableShape = {
    ...(ranks ? { ranks } : {}),
    ...(bars
      ? { bars, labelWidth: labelWidthOf(rows, BARS_LABEL_MAX_CH) }
      : {}),
  };
  if (head.length < 3) {
    return shape;
  }
  const needs = head.map((name, column) =>
    Math.max(
      headNeed(name),
      ...rows.map((row) => cellNeed(row[column] ?? { text: "" })),
    ),
  );
  const rem =
    (needs.reduce((sum, need) => sum + need, 0) +
      COLUMN_GAP_CH * (head.length - 1)) *
    REM_PER_CH;
  if (rem <= FIT_TIERS[0]) {
    return shape;
  }
  const fit = FIT_TIERS.find((tier) => tier >= rem) ?? FIT_TIERS.at(-1);
  const totals = totalsOf(rows);
  return rows.length - totals.length > RECORDS_MAX_ROWS
    ? {
        ...shape,
        fit,
        labelWidth: labelWidthOf(rows, SCROLL_LABEL_MAX_CH),
        narrow: "scroll",
      }
    : {
        ...shape,
        fit,
        narrow: "records",
        ...(totals.length > 0 ? { totals } : {}),
      };
}
