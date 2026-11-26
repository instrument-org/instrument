import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { cn } from "@/client/lib/utils";

import { completeLines, readBlockHeader } from "./parse-body";
import {
  type Chart,
  chartTicks,
  formatTick,
  formatValue,
  parseChart,
  type Unit,
  withUnit,
} from "./parse-chart";
import { plainTextOf } from "./plain-text";
import { useReplyMarkdown } from "./reply-markdown-context";

/**
 * A chart block: numbers whose shape matters, drawn by hand from the table
 * the reply wrote. Bars in one neutral tone with the highlighted one in the
 * brand color, or a thin line; light gridlines, muted labels, no frame. Data
 * it cannot draw is the table it is, never an error.
 */
export function ChartBlock({
  code,
  isArriving,
}: {
  code: string;
  isArriving: boolean;
}) {
  const markdown = useReplyMarkdown();
  const { body, header } = readBlockHeader(
    completeLines(code, isArriving),
    "chart",
  );
  const chart = parseChart(body, header);

  if (!chart) {
    return isArriving || body.trim() === "" ? null : (
      <>{markdown.block(body)}</>
    );
  }

  const { table } = chart;
  return (
    <>
      {table.before && markdown.block(table.before)}
      <figure
        className="not-prose @container my-[1.5em] first:mt-0 last:mb-0"
        data-slot="chart"
      >
        {(chart.title || chart.series.length > 1) && (
          <figcaption className="mb-3 flex flex-col gap-1.5">
            {chart.title && (
              <span className="text-sm font-medium">{chart.title}</span>
            )}
            {chart.series.length > 1 && <Legend chart={chart} />}
          </figcaption>
        )}
        <ChartBody chart={chart} />
        <CopyData disabled={isArriving} rows={[table.head, ...table.rows]} />
      </figure>
      {table.after && markdown.block(table.after)}
    </>
  );
}

const SERIES_TONES = [
  "bg-brand-500 dark:bg-brand-400",
  "bg-yellow-500",
  "bg-brand-200",
  "bg-gray-500",
];
const SERIES_STROKES = [
  "text-brand-500 dark:text-brand-400",
  "text-yellow-500",
  "text-brand-200",
  "text-gray-500",
];
const NEUTRAL_BAR = "bg-gray-300 dark:bg-gray-600";
const HIGHLIGHT_BAR = "bg-brand-500 dark:bg-brand-400";
const NEUTRAL_LINE = "text-gray-500 dark:text-gray-400";

const barTone = (chart: Chart, series: number, row: number) =>
  chart.series.length > 1
    ? (SERIES_TONES[series] ?? NEUTRAL_BAR)
    : row === chart.highlight
      ? HIGHLIGHT_BAR
      : NEUTRAL_BAR;

function Legend({ chart }: { chart: Chart }) {
  return (
    <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      {chart.series.map((series, index) => (
        <span className="flex items-center gap-1.5" key={index}>
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-[2px]",
              SERIES_TONES[index] ?? NEUTRAL_BAR,
            )}
          />
          {series.name}
        </span>
      ))}
    </span>
  );
}

function ChartBody({ chart }: { chart: Chart }) {
  const rows = chart.labels.length;
  const longLabel = chart.labels.some((label) => label.length > 10);
  const negative = chart.series.some((series) =>
    series.values.some((value) => value !== null && value < 0),
  );
  if (chart.type === "line") {
    return <VerticalPlot chart={chart} />;
  }
  if (!negative && (longLabel || rows > 8)) {
    return <HorizontalBars chart={chart} />;
  }
  if (!negative && rows > 5) {
    // Six to eight short bars stand up where there is room and lie down
    // where there is not.
    return (
      <>
        <div className="hidden @[35rem]:block">
          <VerticalPlot chart={chart} />
        </div>
        <div className="@[35rem]:hidden">
          <HorizontalBars chart={chart} />
        </div>
      </>
    );
  }
  return <VerticalPlot chart={chart} />;
}

function HorizontalBars({ chart }: { chart: Chart }) {
  const values = chart.series.flatMap((series) =>
    series.values.filter((value) => value !== null),
  );
  const top = Math.max(...values, 0) || 1;
  return (
    <div
      className="grid grid-cols-[fit-content(38%)_minmax(0,1fr)] gap-x-3"
      role="list"
    >
      {chart.labels.map((label, row) => (
        <div
          className="col-span-full grid grid-cols-subgrid items-center"
          key={row}
          role="listitem"
        >
          <span
            className={cn(
              "line-clamp-2 py-1 text-xs",
              row === chart.highlight
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <span className="flex min-w-0 flex-col justify-center gap-[3px] self-stretch border-l border-foreground/15 py-1">
            {chart.series.map((series, index) => {
              const value = series.values[row];
              return (
                <span className="flex min-w-0 items-center gap-1.5" key={index}>
                  <span
                    className={cn(
                      "shrink-0 rounded-r-[3px]",
                      chart.series.length > 1 ? "h-2" : "h-3",
                      barTone(chart, index, row),
                    )}
                    style={{
                      width: `calc((100% - 4.5rem) * ${(value ?? 0) / top})`,
                    }}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {value === null || value === undefined
                      ? ""
                      : formatValue(
                          series.texts[row] ?? "",
                          value,
                          chart.unit,
                          series.decimals,
                        )}
                  </span>
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Where the label at `index` of `count` shows, so a long run keeps its labels
 * apart: the first and the last always, and as many as fit between them at
 * least `ceil(count / most)` apart, spread evenly.
 */
const labelVisibility = (index: number, count: number) => {
  const shows = (most: number) => {
    const gaps = Math.floor((count - 1) / Math.ceil(count / most));
    return (
      gaps === 0 ||
      Math.round(
        Math.round((index * gaps) / (count - 1)) * ((count - 1) / gaps),
      ) === index
    );
  };
  return cn(
    shows(6) ? "visible" : "invisible",
    shows(12) ? "@[35rem]:visible" : "@[35rem]:invisible",
  );
};

function VerticalPlot({ chart }: { chart: Chart }) {
  const values = chart.series.flatMap((series) =>
    series.values.filter((value) => value !== null),
  );
  const ticks = chartTicks(values, { includeZero: chart.type === "bar" });
  const low = ticks[0] ?? 0;
  const high = ticks.at(-1) ?? 1;
  const at = (value: number) => ((value - low) / (high - low || 1)) * 100;
  const zero = at(Math.min(Math.max(0, low), high));
  const count = chart.labels.length;
  const isLine = chart.type === "line";
  const tickTexts = ticks.map((tick, index) =>
    tickText(
      tick,
      chart.unit,
      index === ticks.length - 1,
      Math.max(...ticks.map(Math.abs)),
    ),
  );
  const valueSize = isLine ? undefined : valueLabelSize(chart, tickTexts);

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5",
        valueSize && "pt-4",
      )}
    >
      <div
        aria-hidden
        className="flex h-40 flex-col-reverse justify-between text-right text-xs text-muted-foreground tabular-nums @[35rem]:h-50"
      >
        {tickTexts.map((text, index) => (
          <span className="flex h-0 items-center justify-end" key={index}>
            {text}
          </span>
        ))}
      </div>
      <div className="relative h-40 @[35rem]:h-50">
        {ticks.map((tick, index) => (
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 h-px",
              tick === 0 || (index === 0 && low > 0)
                ? "bg-foreground/20"
                : "bg-foreground/[0.07]",
            )}
            key={index}
            style={{ bottom: `${at(tick)}%` }}
          />
        ))}
        {isLine && <Lines at={at} chart={chart} />}
        <div className="absolute inset-0 flex">
          {chart.labels.map((label, row) => (
            <Column
              at={at}
              chart={chart}
              count={count}
              key={row}
              label={label}
              row={row}
              valueSize={valueSize}
              zero={zero}
            />
          ))}
        </div>
      </div>
      <div />
      <div className="mt-1.5 flex text-xs text-muted-foreground">
        {chart.labels.map((label, row) => (
          <span
            className={cn(
              "flex min-w-0 flex-1 justify-center",
              isLine && labelVisibility(row, count),
            )}
            key={row}
          >
            <span
              className={cn(
                "whitespace-nowrap",
                !isLine && "truncate",
                row === chart.highlight && "font-medium text-foreground",
              )}
            >
              {label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The most bars a chart labels with their values. */
const VALUE_LABELS_MAX = 12;

// What an extra-small label takes per character, at its widest (a figure).
const LABEL_CHAR_WIDTH = 7;

/**
 * The size of the values over a bar chart's bars: the extra-small text where
 * the block is wide enough that no two touch, and nothing at all where it is
 * not, in a CSS `clamp` against the block's own width. A bar's room is the
 * plot's share for it: the block less the scale beside it, over the rows, and
 * with several series, over the middle of its row that the bars stand in,
 * no wider than a bar. Undefined past `VALUE_LABELS_MAX` bars, or where a
 * bar is never wide enough.
 */
const valueLabelSize = (chart: Chart, tickTexts: string[]) => {
  const rows = chart.labels.length;
  const series = chart.series.length;
  if (rows * series > VALUE_LABELS_MAX) {
    return undefined;
  }
  const widest = (texts: string[]) =>
    Math.max(0, ...texts.map((text) => text.length)) * LABEL_CHAR_WIDTH;
  const label =
    widest(
      chart.series.flatMap((each) =>
        each.values.map((value, row) =>
          value === null
            ? ""
            : formatValue(
                each.texts[row] ?? "",
                value,
                chart.unit,
                each.decimals,
              ),
        ),
      ),
    ) + 8;
  if (series > 1 && label > 42) {
    return undefined;
  }
  const plot = series > 1 ? (rows * series * label) / 0.68 : rows * label;
  const block = Math.ceil(plot + widest(tickTexts) + 10);
  return `clamp(0px, (100cqi - ${block}px) * 100, 0.75rem)`;
};

/** A tick's label: currency and `%` on every one, a word unit on the top one only. */
const tickText = (tick: number, unit: Unit, isTop: boolean, scale: number) => {
  const text = formatTick(tick, scale);
  if (unit.prefix || unit.suffix === "%") {
    return withUnit(text, unit);
  }
  return isTop ? withUnit(text, unit) : text;
};

function Column({
  at,
  chart,
  count,
  label,
  row,
  valueSize,
  zero,
}: {
  at: (value: number) => number;
  chart: Chart;
  count: number;
  label: string;
  row: number;
  /** The size of each bar's value over it; none drawn without one. */
  valueSize?: string;
  zero: number;
}) {
  const isLine = chart.type === "line";
  const present = chart.series.flatMap((series) => {
    const value = series.values[row];
    return value === null || value === undefined ? [] : [value];
  });
  const peak = present.length > 0 ? at(Math.max(...present, 0)) : zero;
  const tooltipSide =
    row === 0 && count > 2
      ? "left-0"
      : row === count - 1 && count > 2
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div className="group/column relative h-full min-w-0 flex-1">
      {isLine ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px bg-foreground/15 opacity-0 group-hover/column:opacity-100"
        />
      ) : (
        <span className="absolute inset-y-0 right-[16%] left-[16%] flex justify-center gap-0.5">
          {chart.series.map((series, index) => {
            const value = series.values[row];
            if (value === null || value === undefined) {
              return <span className="max-w-10 flex-1" key={index} />;
            }
            const end = at(value);
            return (
              <span className="relative max-w-10 flex-1" key={index}>
                <span
                  className={cn(
                    "absolute inset-x-0 transition-opacity group-hover/column:opacity-80",
                    value >= 0 ? "rounded-t-[3px]" : "rounded-b-[3px]",
                    barTone(chart, index, row),
                  )}
                  style={{
                    bottom: `${Math.min(end, zero)}%`,
                    height: `${Math.abs(end - zero)}%`,
                  }}
                />
                {/* Over the bar's end, or over the baseline for a bar that
                    goes down from it. */}
                {valueSize && (
                  <span
                    className={cn(
                      "absolute left-1/2 mb-[3px] -translate-x-1/2 leading-none whitespace-nowrap tabular-nums",
                      row === chart.highlight && chart.series.length === 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                    style={{
                      bottom: `${Math.max(end, zero)}%`,
                      fontSize: valueSize,
                    }}
                  >
                    {formatValue(
                      series.texts[row] ?? "",
                      value,
                      chart.unit,
                      series.decimals,
                    )}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      )}
      {isLine &&
        chart.series.map((series, index) => {
          const value = series.values[row];
          if (value === null || value === undefined) {
            return null;
          }
          const marked =
            row === chart.highlight || row === lastIndexOf(series.values);
          return (
            <span
              aria-hidden
              className={cn(
                "absolute left-1/2 size-[7px] -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-background",
                marked ? "" : "opacity-0 group-hover/column:opacity-100",
                chart.series.length > 1
                  ? (SERIES_TONES[index] ?? NEUTRAL_BAR)
                  : row === chart.highlight
                    ? HIGHLIGHT_BAR
                    : "bg-gray-500 dark:bg-gray-400",
              )}
              key={index}
              style={{ bottom: `${at(value)}%` }}
            />
          );
        })}
      <span
        className={cn(
          "pointer-events-none absolute z-10 mb-2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-float-md ring-1 ring-border transition-opacity group-hover/column:opacity-100",
          tooltipSide,
        )}
        role="tooltip"
        style={{ bottom: `${peak}%` }}
      >
        <span className="block text-muted-foreground">{label}</span>
        {chart.series.map((series, index) => {
          const value = series.values[row];
          if (value === null || value === undefined) {
            return null;
          }
          return (
            <span
              className="flex items-center gap-1.5 tabular-nums"
              key={index}
            >
              {chart.series.length > 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-[2px]",
                    SERIES_TONES[index] ?? NEUTRAL_BAR,
                  )}
                />
              )}
              {formatValue(
                series.texts[row] ?? "",
                value,
                chart.unit,
                series.decimals,
              )}
            </span>
          );
        })}
      </span>
    </div>
  );
}

const lastIndexOf = (values: (null | number)[]) =>
  values.findLastIndex((value) => value !== null);

/**
 * The lines, drawn into a box the plot's size whatever its shape, with the
 * stroke kept at its width by `non-scaling-stroke`. A row with no value
 * breaks its line.
 */
function Lines({ at, chart }: { at: (value: number) => number; chart: Chart }) {
  const count = chart.labels.length;
  return (
    <svg
      aria-hidden
      className="absolute inset-0 size-full overflow-visible"
      preserveAspectRatio="none"
      viewBox="0 0 1000 1000"
    >
      {chart.series.map((series, index) => {
        const runs: string[][] = [[]];
        for (const [row, value] of series.values.entries()) {
          if (value === null) {
            runs.push([]);
            continue;
          }
          const x = ((row + 0.5) / count) * 1000;
          const y = 1000 - at(value) * 10;
          runs.at(-1)?.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        return runs
          .filter((run) => run.length > 1)
          .map((run, part) => (
            <polyline
              className={
                chart.series.length > 1
                  ? (SERIES_STROKES[index] ?? NEUTRAL_LINE)
                  : NEUTRAL_LINE
              }
              fill="none"
              key={`${index}-${part}`}
              points={run.join(" ")}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ));
      })}
    </svg>
  );
}

function CopyData({ disabled, rows }: { disabled: boolean; rows: string[][] }) {
  const { active: copied, trigger } = useTimedFlag();
  return (
    <div className="mt-2.5 text-xs text-muted-foreground">
      <button
        className="rounded-sm hover:text-foreground disabled:pointer-events-none"
        disabled={disabled || rows.length === 0}
        onClick={() => {
          const tsv = rows
            .map((row) => row.map((cell) => plainTextOf(cell)).join("\t"))
            .join("\n");
          void navigator.clipboard.writeText(tsv).then(trigger);
        }}
        type="button"
      >
        {copied ? "Copied" : "Copy data"}
      </button>
    </div>
  );
}
