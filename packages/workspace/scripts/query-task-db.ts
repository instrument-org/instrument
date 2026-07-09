import fs from "node:fs/promises";
import { parseArgs } from "node:util";

import { queryTaskDatabase } from "../src/lib/task-database-query";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    format: { default: "json", type: "string" },
    schema: { default: false, type: "boolean" },
    sql: { type: "string" },
  },
});

const inputPath = positionals[0];
if (!inputPath) {
  throw new TypeError(
    "Usage: pnpm run script:query-task-db <task-directory-or.db> --sql <query>",
  );
}

if (values.format !== "json" && values.format !== "table") {
  throw new TypeError("--format must be json or table");
}

if (values.schema && (values.file || values.sql)) {
  throw new TypeError("--schema cannot be combined with --sql or --file");
}

if (values.file && values.sql) {
  throw new TypeError("Use either --sql or --file, not both");
}

const sql = values.schema
  ? "select type, name, tbl_name, sql from sqlite_master where sql is not null order by type, name"
  : values.file
    ? await fs.readFile(values.file, "utf8")
    : values.sql;

if (!sql) {
  throw new TypeError("Provide --sql, --file, or --schema");
}

const result = queryTaskDatabase({ databasePath: inputPath, sql });
process.stdout.write(
  values.format === "table"
    ? formatTable(result)
    : `${JSON.stringify(result, null, 2)}\n`,
);

function formatTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}): string {
  const header = columns.join(" | ");
  const separator = columns.map(() => "---").join(" | ");
  const tableRows = rows.map((row) =>
    columns.map((column) => formatValue(row[column])).join(" | "),
  );
  return `${[header, separator, ...tableRows].join("\n")}\n`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}
