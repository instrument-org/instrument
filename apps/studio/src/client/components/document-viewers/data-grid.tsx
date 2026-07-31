import { cn } from "@/client/lib/utils";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSpacer,
} from "./viewer-toolbar";

const ROW_HEIGHT = 28;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 420;
// Columns are sized from a sample rather than every row so a million-row table
// does not pay a full scan before first paint.
const WIDTH_SAMPLE_ROWS = 200;
const CHARACTER_WIDTH = 7.2;
const CELL_PADDING = 24;

interface Match {
  column: number;
  row: number;
}

interface Sort {
  column: number;
  direction: "ascending" | "descending";
}

/**
 * The tabular body shared by every viewer whose content is rows and columns:
 * delimited text and database tables today.
 *
 * It takes the whole table rather than a windowing callback. Both callers
 * already hold their rows in memory, and sorting and find are answered across
 * the entire set rather than the visible slice, so a paging interface here
 * would only relocate that work without shrinking it.
 *
 * `note` is for whatever qualifies the row count, such as a table the caller
 * truncated. It sits with the count rather than over the grid so it does not
 * cover data.
 */
export function DataGrid({
  header: rawHeader,
  note,
  rows: rawRows,
}: {
  header: string[];
  note?: string;
  rows: string[][];
}) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [sort, setSort] = useState<null | Sort>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { header, rows } = useMemo(
    () => rectangular({ header: rawHeader, rows: rawRows }),
    [rawHeader, rawRows],
  );

  const columnWidths = useMemo(
    () => measureColumns({ header, rows }),
    [header, rows],
  );

  const sortedRows = useMemo(() => sortRows({ rows, sort }), [rows, sort]);

  // Scanning every cell is O(rows x columns) and this grid is built for large
  // tables, so the scan trails the field rather than keeping pace with it:
  // typing stays responsive and the match runs at a lower priority once React
  // has caught up.
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(
    () => findMatches({ query: deferredQuery, rows: sortedRows }),
    [deferredQuery, sortedRows],
  );

  // Every rendered cell asks whether it is a match, which is the question
  // `findMatches` has already answered for the whole table. Indexed once so the
  // render reads an answer instead of recomputing one per cell per frame.
  const matchKeys = useMemo(
    () => new Set(matches.map((match) => `${match.row}:${match.column}`)),
    [matches],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  });

  // Sorting rebuilds `matches` under an unchanged query, so the index is
  // wrapped rather than trusted: left alone it can point past the new end,
  // dropping the highlight and leaving the readout counting past the total.
  const activeIndex = matches.length === 0 ? 0 : activeMatch % matches.length;
  const current = matches[activeIndex];
  useEffect(() => {
    if (current) {
      virtualizer.scrollToIndex(current.row, { align: "center" });
    }
  }, [current, virtualizer]);

  const goToMatch = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    const next = (activeIndex + delta) % matches.length;
    setActiveMatch(next < 0 ? next + matches.length : next);
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
          {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
          {note ? ` (${note})` : ""}
        </span>
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={activeIndex}
          matchCount={matches.length}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={(next) => {
            setQuery(next);
            // A new query starts at its own first match rather than wherever
            // the previous one happened to be left.
            setActiveMatch(0);
          }}
          query={query}
        />
      </ViewerToolbar>

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div
          className="relative text-[0.8125rem]"
          style={{ width: totalWidth }}
        >
          {/* `card` rather than `muted`, because this one has to be opaque and
              `--muted` is not: in the dark theme it is 8% white, so rows would
              scroll visibly through the header it is pinned above. */}
          <div className="sticky top-0 z-10 flex bg-card">
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
                  const isMatch = matchKeys.has(
                    `${virtualRow.index}:${column}`,
                  );
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
                      style={{
                        width: columnWidths[column] ?? MIN_COLUMN_WIDTH,
                      }}
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

function measureColumns({
  header,
  rows,
}: {
  header: string[];
  rows: string[][];
}) {
  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  return Array.from({ length: header.length }, (_, column) => {
    let widest = header[column]?.length ?? 0;
    for (const row of sample) {
      widest = Math.max(widest, row[column]?.length ?? 0);
    }
    return Math.min(
      Math.max(widest * CHARACTER_WIDTH + CELL_PADDING, MIN_COLUMN_WIDTH),
      MAX_COLUMN_WIDTH,
    );
  });
}

/** Ascending, then descending, then back to the table's own order. */
function nextSort(sort: null | Sort, column: number): null | Sort {
  if (sort?.column !== column) {
    return { column, direction: "ascending" };
  }
  return sort.direction === "ascending"
    ? { column, direction: "descending" }
    : null;
}

/**
 * Squares the table off, padding the header and every row out to the widest of
 * them. A ragged row would otherwise render fewer cells than its neighbours and
 * pull every column after the gap out of line, and a row wider than the header
 * would render cells with no column above them.
 */
function rectangular({ header, rows }: { header: string[]; rows: string[][] }) {
  // Counted with a loop rather than a spread into `Math.max`: a large table has
  // more rows than the argument limit and would overflow the stack.
  let columnCount = header.length;
  for (const row of rows) {
    columnCount = Math.max(columnCount, row.length);
  }
  const pad = (cells: string[]) =>
    cells.length === columnCount
      ? cells
      : Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");

  return { header: pad(header), rows: rows.map(pad) };
}

/**
 * Rows in display order. Unsorted returns the caller's array itself rather than
 * a copy, so the common case adds no allocation to a large table; sorting
 * copies the row references only, not the cells.
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
    if (
      compared !== 0 &&
      (first[sort.column] === "" || second[sort.column] === "")
    ) {
      return compared;
    }
    return compared * direction;
  });
}
