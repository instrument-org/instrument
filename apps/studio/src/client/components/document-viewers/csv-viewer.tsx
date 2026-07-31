import { useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import { useMemo } from "react";

import { FileLoading } from "../file-loading";
import { DataGrid } from "./data-grid";

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
  const { header, rows } = useMemo(
    () => parseDelimited({ filename, text }),
    [filename, text],
  );

  return <DataGrid header={header} rows={rows} />;
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

  return { header: records[0] ?? [], rows: records.slice(1) };
}
