import { cn } from "@/client/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";

import { ViewerLoading } from "./viewer-surface";
import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSeparator,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

const ROW_HEIGHT = 28;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 420;
// Columns are sized from a sample rather than the whole file so a million-row
// export does not pay a full scan before first paint.
const WIDTH_SAMPLE_ROWS = 200;
const CHARACTER_WIDTH = 7.2;
const CELL_PADDING = 24;

interface Match { column: number; row: number }

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
    return <ViewerLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }

  return <CsvGrid filename={filename} text={data ?? ""} />;
}

function CsvGrid({ filename, text }: { filename: string; text: string }) {
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { columnWidths, header, rows } = useMemo(
    () => parseDelimited({ filename, text }),
    [filename, text],
  );

  const matches = useMemo(() => findMatches({ query, rows }), [query, rows]);

  useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT * zoom,
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
    totalWidth += width * zoom;
  }

  return (
    <>
      <ViewerToolbar>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {rows.length.toLocaleString()}{" "}
          {rows.length === 1 ? "row" : "rows"}
        </span>
        <ViewerToolbarSeparator />
        <ViewerZoomControl onZoomChange={setZoom} zoom={zoom} />
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
        <div
          className="relative"
          style={{
            fontSize: `${zoom * 0.8125}rem`,
            width: totalWidth,
          }}
        >
          <div className="sticky top-0 z-10 flex bg-muted/95 backdrop-blur-sm">
            {header.map((cell, column) => (
              <div
                className="truncate border-r border-b border-border/60 px-2 py-1.5 font-medium"
                key={column}
                style={{ width: (columnWidths[column] ?? MIN_COLUMN_WIDTH) * zoom }}
                title={cell}
              >
                {cell}
              </div>
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
                {(rows[virtualRow.index] ?? []).map((cell, column) => {
                  const isMatch =
                    query !== "" &&
                    cell.toLowerCase().includes(query.toLowerCase());
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
                      style={{ width: (columnWidths[column] ?? MIN_COLUMN_WIDTH) * zoom }}
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

  const columnWidths = Array.from({ length: columnCount }, (_, column) => {
    let widest = header[column]?.length ?? 0;
    for (const row of rows.slice(0, WIDTH_SAMPLE_ROWS)) {
      widest = Math.max(widest, row[column]?.length ?? 0);
    }
    return Math.min(
      Math.max(widest * CHARACTER_WIDTH + CELL_PADDING, MIN_COLUMN_WIDTH),
      MAX_COLUMN_WIDTH,
    );
  });

  return { columnWidths, header, rows };
}
