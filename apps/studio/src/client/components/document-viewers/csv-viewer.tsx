import { cn } from "@/client/lib/utils";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";

import { FileLoading } from "../file-loading";
import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSpacer,
} from "./viewer-toolbar";

const ROW_HEIGHT = 28;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 420;
// Columns are sized from a sample rather than the whole file so a million-row
// export does not pay a full scan before first paint.
const WIDTH_SAMPLE_ROWS = 200;
const CHARACTER_WIDTH = 7.2;
const CELL_PADDING = 24;
const FIND_DEBOUNCE_MS = 200;

interface Match { column: number; row: number }

interface Sort { column: number; direction: "ascending" | "descending" }

export function CsvViewer({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["csv-file", url],
    retry: false,
  });

  if (isLoading) {
    return <FileLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }

  return <CsvGrid filename={filename} text={data ?? ""} />;
}

/**
 * Compares two cells as numbers when both read as numbers and as text
 * otherwise, so a column of counts does not sort 10 before 9. Blanks sort last
 * in either direction: they are missing data rather than the smallest value.
 */
function compareCells(first: string, second: string) {
  if (first === second) {
    return 0;
  }
  if (first === "") {
    return 1;
  }
  if (second === "") {
    return -1;
  }
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  if (!Number.isNaN(firstNumber) && !Number.isNaN(secondNumber)) {
    return firstNumber - secondNumber;
  }
  return first.localeCompare(second);
}

function CsvGrid({ filename, text }: { filename: string; text: string }) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [sort, setSort] = useState<null | Sort>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { columnWidths, header, rows } = useMemo(
    () => parseDelimited({ filename, text }),
    [filename, text],
  );

  const sortedRows = useMemo(() => sortRows({ rows, sort }), [rows, sort]);

  // Scanning every cell is O(rows x columns) and this viewer is built for large
  // exports, so it runs on a settled query rather than on each keystroke.
  const settledQuery = useDebounced(query, FIND_DEBOUNCE_MS);
  const matches = useMemo(
    () => findMatches({ query: settledQuery, rows: sortedRows }),
    [settledQuery, sortedRows],
  );

  useEffect(() => {
    setActiveMatch(0);
  }, [settledQuery]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  });

  const current = matches[activeMatch];
  useEffect(() => {
    if (current) {
      virtualizer.scrollToIndex(current.row, { align: "center" });
    }
  }, [current, virtualizer]);

  const goToMatch = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    setActiveMatch((index) => {
      const next = (index + delta) % matches.length;
      return next < 0 ? next + matches.length : next;
    });
  };

  let totalWidth = 0;
  for (const width of columnWidths) {
    totalWidth += width;
  }

  return (
    <>
      {/* No zoom control: the grid is plain DOM text that the window's own zoom
          already scales, so a second scale factor inside it would only be a
          way to disagree with the rest of the app. */}
      <ViewerToolbar>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {rows.length.toLocaleString()}{" "}
          {rows.length === 1 ? "row" : "rows"}
        </span>
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={activeMatch}
          matchCount={matches.length}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={setQuery}
          query={query}
        />
      </ViewerToolbar>

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div className="relative text-[0.8125rem]" style={{ width: totalWidth }}>
          <div className="sticky top-0 z-10 flex bg-muted/95 backdrop-blur-sm">
            {header.map((cell, column) => (
              <button
                className="flex items-center gap-1 border-r border-b border-border/60 px-2 py-1.5 text-left font-medium hover:bg-muted"
                key={column}
                onClick={() => {
                  setSort(nextSort(sort, column));
                }}
                style={{ width: columnWidths[column] ?? MIN_COLUMN_WIDTH }}
                title={`Sort by ${cell}`}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{cell}</span>
                {sort?.column === column &&
                  (sort.direction === "ascending" ? (
                    <CaretUpIcon className="size-3 shrink-0" />
                  ) : (
                    <CaretDownIcon className="size-3 shrink-0" />
                  ))}
              </button>
            ))}
          </div>

          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                className="absolute inset-x-0 flex"
                key={virtualRow.key}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {(sortedRows[virtualRow.index] ?? []).map((cell, column) => {
                  const isMatch =
                    settledQuery !== "" &&
                    cell.toLowerCase().includes(settledQuery.toLowerCase());
                  const isActive =
                    current?.row === virtualRow.index &&
                    current.column === column;
                  return (
                    <div
                      className={cn(
                        "truncate border-r border-b border-border/40 px-2 py-1",
                        virtualRow.index % 2 === 1 && "bg-muted/30",
                        isMatch && "bg-yellow-500/25",
                        isActive && "bg-yellow-500/60",
                      )}
                      key={column}
                      style={{ width: columnWidths[column] ?? MIN_COLUMN_WIDTH }}
                      title={cell}
                    >
                      {cell}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function findMatches({ query, rows }: { query: string; rows: string[][] }) {
  if (query === "") {
    return [];
  }
  const needle = query.toLowerCase();
  const found: Match[] = [];
  for (const [row, cells] of rows.entries()) {
    for (const [column, cell] of cells.entries()) {
      if (cell.toLowerCase().includes(needle)) {
        found.push({ column, row });
      }
    }
  }
  return found;
}

/** Ascending, then descending, then back to the file's own order. */
function nextSort(sort: null | Sort, column: number): null | Sort {
  if (sort?.column !== column) {
    return { column, direction: "ascending" };
  }
  return sort.direction === "ascending"
    ? { column, direction: "descending" }
    : null;
}

function parseDelimited({
  filename,
  text,
}: {
  filename: string;
  text: string;
}) {
  const parsed = Papa.parse<string[]>(text, {
    // Papa infers the delimiter, but a `.tsv` whose first line happens to hold
    // more commas than tabs would be inferred wrong, so the extension decides.
    delimiter: filename.toLowerCase().endsWith(".tsv") ? "\t" : undefined,
    skipEmptyLines: "greedy",
  });

  const records = parsed.data.filter(Array.isArray);
  // Counted with a loop rather than a spread into `Math.max`: a large export
  // has more rows than the argument limit and would overflow the stack.
  let columnCount = 0;
  for (const record of records) {
    columnCount = Math.max(columnCount, record.length);
  }

  // A ragged row would otherwise render fewer cells than the header, so every
  // row is padded to the widest one and the grid stays rectangular.
  const normalize = (record: string[] | undefined) =>
    Array.from({ length: columnCount }, (_, index) => record?.[index] ?? "");

  const header = records.length > 0 ? normalize(records[0]) : [];
  const rows = records.slice(1).map((record) => normalize(record));

  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  const columnWidths = Array.from({ length: columnCount }, (_, column) => {
    let widest = header[column]?.length ?? 0;
    for (const row of sample) {
      widest = Math.max(widest, row[column]?.length ?? 0);
    }
    return Math.min(
      Math.max(widest * CHARACTER_WIDTH + CELL_PADDING, MIN_COLUMN_WIDTH),
      MAX_COLUMN_WIDTH,
    );
  });

  return { columnWidths, header, rows };
}

/**
 * Rows in display order. Unsorted returns the parsed array itself rather than a
 * copy, so the common case adds no allocation to a large export; sorting copies
 * the row references only, not the cells.
 */
function sortRows({ rows, sort }: { rows: string[][]; sort: null | Sort }) {
  if (!sort) {
    return rows;
  }
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...rows].sort((first, second) => {
    const compared = compareCells(
      first[sort.column] ?? "",
      second[sort.column] ?? "",
    );
    // Blanks are pushed to the end by `compareCells` regardless of direction,
    // so their ordering is not flipped along with everything else.
    if (compared !== 0 && (first[sort.column] === "" || second[sort.column] === "")) {
      return compared;
    }
    return compared * direction;
  });
}

/** Holds a value back until it has stopped changing for `delay` ms. */
function useDebounced(value: string, delay: number) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [delay, value]);

  return settled;
}
