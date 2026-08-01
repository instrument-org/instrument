import { useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import { useMemo } from "react";

import { FileLoading } from "../file-loading";
import { type CellValue, DataGrid, type GridColumn } from "./data-grid";
import { inferAlignment } from "./grid-columns";

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

function CsvGrid({ filename, text }: { filename: string; text: string }) {
  const { columns, rows } = useMemo(
    () => parseDelimited({ filename, text }),
    [filename, text],
  );

  return <DataGrid columns={columns} rows={rows} />;
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

  const records = parsed.data.filter(
    (record): record is string[] => Array.isArray(record),
  );
  const header = records[0] ?? [];
  const rows: CellValue[][] = records.slice(1);

  // Delimited text carries no types, so alignment is read off the values
  // themselves. A missing cell is an empty string rather than null: the format
  // has no way to say "absent" as distinct from "empty".
  const columns: GridColumn[] = header.map((name, index) => ({
    align: inferAlignment({ index, rows }),
    name,
  }));

  return { columns, rows };
}
