import { type ParsedTable, parseTable } from "./parse-body";
import { parseValue } from "./parse-value";
import { plainTextOf } from "./plain-text";

interface ChartSeries {
  /** The most decimals any of its values was written with, which every value label takes. */
  decimals: number;
  name: string;
  /** The cells as written, for value labels; "" where the row has none. */
  texts: string[];
  /** Null where the row has no value. */
  values: (null | number)[];
}

export interface Chart {
  /** The label the header names, by its index. */
  highlight?: number;
  labels: string[];
  series: ChartSeries[];
  /** The table the chart is drawn from, which "Copy data" copies. */
  table: ParsedTable;
  title?: string;
  type: "bar" | "line";
  unit: Unit;
}

export interface Unit {
  prefix: string;
  suffix: string;
}

/** Past these the data is drawn as the table it is. */
const CHART_MAX_ROWS = 24;
const CHART_MAX_SERIES = 4;

const CURRENCY = /^[$€£¥₹]$/;

/** The unit a header names: currency before the number, anything else after it. */
const unitOf = (written: string | undefined): Unit | undefined => {
  if (written === undefined || written.trim() === "") {
    return undefined;
  }
  const unit = written.trim();
  if (CURRENCY.test(unit)) {
    return { prefix: unit, suffix: "" };
  }
  // "%" and "kWh" are written against the number the way people write them;
  // a word unit takes a space.
  return {
    prefix: "",
    suffix: unit === "%" || written.startsWith(" ") ? written : ` ${unit}`,
  };
};

const MONTH =
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(\s+'?\d{2,4})?$/i;
const TIME_LABELS = [
  MONTH,
  /^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(\s+\d{2,4})?$/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?$/i,
  /^(fy\s?)?'?\d{2,4}$/i,
  /^(q[1-4]|h[12])(\s+'?\d{2,4})?$/i,
  /^'?\d{2,4}\s+(q[1-4]|h[12])$/i,
  /^(w|wk|week)\s*\d{1,2}(\s+\d{4})?$/i,
  /^\d{4}-\d{2}(-\d{2})?$/,
  /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i,
];

/** Whether the labels read as points in time: months, dates, years, quarters, weeks. */
export const isTimeSeries = (labels: string[]) =>
  labels.length > 0 &&
  labels.every((label) => TIME_LABELS.some((pattern) => pattern.test(label)));

/**
 * Reads a chart block's body: a table whose first column labels the rows and
 * whose other columns are the series. Undefined when the table is missing,
 * holds no numbers, or is past what a chart draws, which the block reads as
 * "draw the table".
 */
export function parseChart(
  body: string,
  header: Record<string, string>,
): Chart | undefined {
  const table = parseTable(body);
  if (!table || table.rows.length === 0 || table.head.length < 2) {
    return undefined;
  }
  if (
    table.rows.length > CHART_MAX_ROWS ||
    table.head.length - 1 > CHART_MAX_SERIES
  ) {
    return undefined;
  }
  const labels = table.rows.map((row) => plainTextOf(row[0] ?? ""));
  const prefixes = new Set<string>();
  const suffixes = new Set<string>();
  const series: ChartSeries[] = [];
  for (const [column, name] of table.head.entries()) {
    if (column === 0) {
      continue;
    }
    const texts = table.rows.map((row) => (row[column] ?? "").trim());
    const values: (null | number)[] = [];
    let decimals = 0;
    for (const text of texts) {
      if (text === "" || text === "-" || text === "—") {
        values.push(null);
        continue;
      }
      const parsed = parseValue(text);
      if (!parsed) {
        return undefined;
      }
      prefixes.add(parsed.prefix);
      suffixes.add(parsed.suffix);
      values.push(parsed.value);
      decimals = Math.max(decimals, parsed.scaled ? 0 : parsed.decimals);
    }
    if (values.every((value) => value === null)) {
      return undefined;
    }
    series.push({ decimals, name: plainTextOf(name), texts, values });
  }

  const written = unitOf(header.unit);
  const unit = written ?? {
    prefix: prefixes.size === 1 ? ([...prefixes][0] ?? "") : "",
    suffix: suffixes.size === 1 ? ([...suffixes][0] ?? "") : "",
  };
  const type = /^line/i.test(header.type ?? "")
    ? "line"
    : /^(bar|column)/i.test(header.type ?? "")
      ? "bar"
      : isTimeSeries(labels) && labels.length >= 4
        ? "line"
        : "bar";
  const wanted = plainTextOf(header.highlight ?? "").toLowerCase();
  const highlight = wanted
    ? labels.findIndex((label) => label.toLowerCase() === wanted)
    : -1;

  return {
    labels,
    series,
    table,
    type,
    unit,
    ...(header.title ? { title: plainTextOf(header.title) } : {}),
    ...(highlight === -1 ? {} : { highlight }),
  };
}

/**
 * The values the gridlines stand at: the baseline and up to three more, at a
 * round step. Bars always include zero; a line includes it when its values
 * are near it, so a line of temperatures is not flattened into its top.
 */
export function chartTicks(
  values: number[],
  { includeZero }: { includeZero: boolean },
): number[] {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (includeZero || (low >= 0 && low <= high - low)) {
    low = Math.min(0, low);
    high = Math.max(0, high);
  }
  if (high === low) {
    high = low === 0 ? 1 : high + Math.abs(high) * 0.5;
    low = low === 0 ? 0 : low - Math.abs(low) * 0.5;
  }
  // The round step that comes closest to three gridlines over the baseline,
  // taking four or two before five.
  const magnitude = 10 ** Math.floor(Math.log10((high - low) / 3));
  const intervals = (step: number) =>
    Math.ceil(high / step - 1e-9) - Math.floor(low / step + 1e-9);
  const preference = [3, 4, 2, 5, 6];
  const step =
    [0.5, 1, 2, 2.5, 5, 10, 20]
      .map((factor) => factor * magnitude)
      .map((candidate) => ({
        candidate,
        rank: preference.indexOf(intervals(candidate)),
      }))
      .filter(({ rank }) => rank !== -1)
      .sort((a, b) => a.rank - b.rank)[0]?.candidate ?? magnitude;
  const first = Math.floor(low / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let tick = first; tick < high + step - 1e-9; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

const compact = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * A number short enough for the axis: `1,200`, `12K`, `1.5M`. `scale` is the
 * largest number on the same axis, so every tick on it is written one way.
 */
export const formatTick = (value: number, scale = value) =>
  Math.abs(scale) >= 10_000 ? compact.format(value) : plain.format(value);

const fixedFormats = new Map<number, Intl.NumberFormat>();
const fixedFormat = (decimals: number) => {
  let format = fixedFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
    fixedFormats.set(decimals, format);
  }
  return format;
};

/**
 * A value as its label shows it: grouped, at the decimals its series was
 * written with (`$182.40`, not `$182.4`), in the unit its own cell carries or
 * else the chart's. A value written with a scale letter (`$1.2M`) is shown as
 * written, which is shorter than any spelling of it.
 */
export const formatValue = (
  text: string,
  value: number,
  unit: Unit,
  decimals: number,
) => {
  const parsed = parseValue(text);
  if (parsed?.scaled) {
    return plainTextOf(text);
  }
  const number = fixedFormat(decimals).format(value);
  return withUnit(
    number,
    parsed && (parsed.prefix || parsed.suffix) ? parsed : unit,
  );
};

/** A value with its unit around it, for a value read off the scale. */
export const withUnit = (text: string, unit: Unit) =>
  `${text.startsWith("-") ? "-" : ""}${unit.prefix}${text.replace(/^-/, "")}${unit.suffix}`;
