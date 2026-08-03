import { useQuery } from "@tanstack/react-query";
import Papa from "papaparse";

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

  // Keyed by url so a second file starts on a fresh grid rather than inheriting
  // the sort, filter and hidden columns the reader set up for the last one,
  // which are all held by column position and would land on unrelated data.
  return <CsvGrid filename={filename} key={url} text={data ?? ""} />;
}

function CsvGrid({ filename, text }: { filename: string; text: string }) {
  const { columns, rows } = parseDelimited({ filename, text });

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

  // Ragged files are ordinary rather than broken, so every record is squared
  // off to the widest one. A row carrying more fields than the header names
  // would otherwise have them silently dropped, and a shorter one would report
  // trailing cells as absent, which delimited text has no way to say.
  let width = 0;
  for (const record of records) {
    width = Math.max(width, record.length);
  }

  const header = records[0] ?? [];
  const rows: CellValue[][] = records
    .slice(1)
    .map((record) =>
      Array.from({ length: width }, (_, index) => record[index] ?? ""),
    );

  // Delimited text carries no types, so alignment is read off the values.
  const columns: GridColumn[] = Array.from({ length: width }, (_, index) => ({
    align: inferAlignment({ index, rows }),
    name: header[index] ?? "",
  }));

  return { columns, rows };
}
