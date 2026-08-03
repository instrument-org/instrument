import { useQuery } from "@tanstack/react-query";

import { FileLoading } from "../file-loading";
import { type CellValue, DataGrid, type GridColumn } from "./data-grid";
import { inferAlignment } from "./grid-columns";

// Union-ing keys across a very large file would mean holding every distinct key
// seen, and a log with an unbounded key space is exactly the file that produces
// them. The columns come from a prefix instead, which is where a well-formed
// export puts its shape anyway.
const KEY_SAMPLE_LINES = 1000;

// A log is the file most likely to arrive here and the one with no ceiling on
// its length, so parsing stops at the same bound the database and Parquet
// viewers read to. The grid holds every row it is given and answers sort and
// filter across all of them, which is what makes an unbounded read a way to
// hang the renderer rather than a way to show a large file.
const MAX_ROWS = 100_000;

/**
 * Line-delimited JSON, as a table when the lines describe one and as text when
 * they do not.
 *
 * The format is one JSON value per line and nothing constrains those values to
 * be objects, let alone objects sharing a shape. A file of arrays or bare
 * numbers is perfectly valid JSONL and has no columns, so rather than force it
 * into a grid with a single unnamed column, it falls back to reading as text.
 */
export function JsonlViewer({ url }: { url: string }) {
  const { data, error, isLoading } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["jsonl-file", url],
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

  // Keyed by url so a second file starts on a fresh grid rather than inheriting
  // the sort, filter and hidden columns the reader set up for the last one,
  // which are all held by column position and would land on unrelated data.
  return <JsonlBody key={url} text={data ?? ""} />;
}

/**
 * A value inside a record. Nested objects and arrays are shown as JSON: a cell
 * is one line, and the alternative for a column of them is `[object Object]`
 * repeated down the table.
 */
function formatValue(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // A BigInt, or anything else JSON refuses, is still one cell rather than
      // a reason to fail the whole file.
      return "<unreadable>";
    }
  }
  // Spelled out rather than a bare `String()`: the remaining types include
  // symbol, which throws when coerced, and that would fail the whole file over
  // one cell.
  if (
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return String(value);
  }
  return "<unreadable>";
}

function JsonlBody({ text }: { text: string }) {
  const parsed = parseLines(text);

  if (!parsed) {
    // Valid JSONL that is not tabular still deserves to be readable, so it
    // falls through to the same plain rendering an unrecognised text file gets
    // rather than to the "preview unavailable" card.
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <pre className="font-mono text-xs whitespace-pre-wrap">{text}</pre>
      </div>
    );
  }

  return (
    <DataGrid
      columns={parsed.columns}
      note={parsed.note}
      rows={parsed.rows}
    />
  );
}

function parseLines(text: string) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const records: Record<string, unknown>[] = [];
  let malformed = 0;
  let truncated = false;

  for (const line of lines) {
    if (records.length === MAX_ROWS) {
      truncated = true;
      break;
    }
    try {
      const value: unknown = JSON.parse(line);
      // Arrays are objects too, and an array per line is a list rather than a
      // record, so it does not become a row of named columns.
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      } else {
        malformed += 1;
      }
    } catch {
      // A truncated final line is the usual case here: a log still being
      // written ends mid-record. Counting them is more useful than refusing to
      // show the lines that did parse.
      malformed += 1;
    }
  }

  if (records.length === 0) {
    return null;
  }

  const keys = new Set<string>();
  for (const record of records.slice(0, KEY_SAMPLE_LINES)) {
    for (const key of Object.keys(record)) {
      keys.add(key);
    }
  }
  const header = [...keys];

  const rows: CellValue[][] = records.map((record) =>
    header.map((key) => formatValue(record[key])),
  );

  const columns: GridColumn[] = header.map((name, index) => ({
    align: inferAlignment({ index, rows }),
    name,
  }));

  const notes: string[] = [];
  if (truncated) {
    notes.push(
      `first ${MAX_ROWS.toLocaleString()} of ${lines.length.toLocaleString()} lines`,
    );
  }
  if (malformed > 0) {
    notes.push(
      `${malformed.toLocaleString()} ${malformed === 1 ? "line" : "lines"} skipped`,
    );
  }

  return {
    columns,
    note: notes.length > 0 ? notes.join(", ") : undefined,
    rows,
  };
}
