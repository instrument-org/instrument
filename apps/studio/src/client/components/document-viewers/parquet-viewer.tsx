import { useQuery } from "@tanstack/react-query";

import { FileLoading } from "../file-loading";
import { type CellValue, DataGrid, type GridColumn } from "./data-grid";
import { inferAlignment } from "./grid-columns";

// Parquet is a columnar format built for datasets far larger than anything the
// grid should hold at once, so the read stops here and says so rather than
// filling memory with a file that was never meant to be looked at whole.
const MAX_ROWS = 100_000;

// Parquet is schema-driven, so every record carries the same keys and a prefix
// is enough to collect them. Reading all of them would allocate a key array per
// row for no answer the first few thousand have not already given.
const KEY_SAMPLE_ROWS = 1000;

/**
 * Parquet files, read with `hyparquet`.
 *
 * The reader is plain JavaScript with no wasm behind it, which is why this
 * viewer needs nothing from the vendor asset pipeline: the whole parse happens
 * in the chunk this module already loads.
 */
export function ParquetViewer({ url }: { url: string }) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => readParquet(url),
    queryKey: ["parquet-file", url],
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
  if (!data) {
    throw new Error("This file holds no readable Parquet data.");
  }

  // Keyed by url so a second file starts on a fresh grid rather than inheriting
  // the sort, filter and hidden columns the reader set up for the last one,
  // which are all held by column position and would land on unrelated data.
  return (
    <DataGrid
      columns={data.columns}
      key={url}
      note={data.note}
      rows={data.rows}
    />
  );
}

/**
 * Parquet values are typed, and several of those types have no faithful string
 * form, so each is rendered as what it is rather than coerced.
 *
 * Nested groups and lists arrive as objects and arrays. They are shown as JSON
 * because the alternative -- `[object Object]` in every cell -- tells a reader
 * nothing about a column that may be the point of the file.
 */
function formatValue(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return `<${value.length.toLocaleString()} bytes>`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // Circular structures cannot come out of a Parquet file, but a value
      // that throws here would otherwise take the whole table down with it.
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

async function readParquet(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();

  const { parquetMetadataAsync, parquetReadObjects } = await import(
    "hyparquet"
  );
  const metadata = await parquetMetadataAsync(buffer);
  const total = Number(metadata.num_rows);

  const records = await parquetReadObjects({
    file: buffer,
    metadata,
    rowEnd: Math.min(total, MAX_ROWS),
    rowStart: 0,
  });

  // Column names come from the records rather than from the schema. The schema
  // is a tree, and a nested column such as `list<string>` reaches its values
  // through wrapper nodes the format names itself, so collecting leaf names
  // yields a column called `element` that matches no key on any record. The
  // reader has already resolved that tree; its keys are the real columns.
  const header = [
    ...new Set(
      records
        .slice(0, KEY_SAMPLE_ROWS)
        .flatMap((record) => Object.keys(record)),
    ),
  ];

  const rows: CellValue[][] = records.map((record) =>
    header.map((name) =>
      formatValue((record as Record<string, unknown>)[name]),
    ),
  );

  const columns: GridColumn[] = header.map((name, index) => ({
    align: inferAlignment({ index, rows }),
    name,
  }));

  return {
    columns,
    note:
      total > MAX_ROWS
        ? `first ${MAX_ROWS.toLocaleString()} of ${total.toLocaleString()}`
        : undefined,
    rows,
  };
}
