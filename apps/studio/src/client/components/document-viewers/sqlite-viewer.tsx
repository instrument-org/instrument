import { SQLITE_WASM_URL } from "@/client/lib/document-viewers";
import { cn } from "@/client/lib/utils";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
  type SqlValue,
} from "@sqlite.org/sqlite-wasm";
import { useEffect, useMemo, useState } from "react";

import { FileLoading } from "../file-loading";
import { type CellValue, DataGrid, type GridColumn } from "./data-grid";
import { inferAlignment } from "./grid-columns";

// A database is the one format here with no natural ceiling on its own size, so
// a table is read up to a bound rather than in full. The grid holds every row
// it is given in memory and answers sort and find across all of them, which is
// what makes an unbounded read a way to hang the renderer on someone's
// multi-gigabyte export rather than a way to show it.
const MAX_ROWS = 100_000;

// SQLite's declared types are free text with only affinity rules behind them,
// so this matches the families that carry numbers rather than an exact list.
const NUMERIC_TYPE = /INT|REAL|FLOA|DOUB|NUMERIC|DEC/i;

interface TableInfo {
  name: string;
  type: "table" | "view";
}

/**
 * Read-only browser for a SQLite database: its tables and views, one at a time,
 * through the shared {@link DataGrid}.
 *
 * The whole file is read into wasm memory and opened from there. That is the
 * same shape as every other viewer here, which hands its parser the bytes it
 * fetched, and it is what keeps the database on disk untouched: nothing this
 * viewer does can reach the user's file, so a preview cannot corrupt or lock a
 * database something else is using.
 *
 * Running it in wasm rather than through the main process's native SQLite is
 * deliberate beyond convenience. These files are untrusted and frequently
 * malformed, and SQLite is explicit that it is not hardened against hostile
 * database files; a wasm trap takes out this viewer, where the equivalent in
 * main would take the window with it.
 */
export function SqliteViewer({ url }: { url: string }) {
  const database = useDatabase(url);
  const [selected, setSelected] = useState<null | string>(null);

  if (database.status === "error") {
    // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
    // which owns the "preview unavailable" card for every viewer.
    throw database.error;
  }
  if (database.status === "loading") {
    return <FileLoading />;
  }

  const active =
    database.tables.find((table) => table.name === selected) ??
    database.tables[0];

  if (!active) {
    throw new Error("This database has no tables to show.");
  }

  return (
    <>
      <TableContents db={database.db} table={active} />

      {database.tables.length > 1 && (
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-2">
          {database.tables.map((table) => (
            <button
              aria-current={table.name === active.name ? "true" : undefined}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs whitespace-nowrap",
                table.name === active.name
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
                // A view is still a table's worth of rows, but it is derived
                // rather than stored, and telling them apart matters when
                // deciding what a number came from.
                table.type === "view" && "italic",
              )}
              key={table.name}
              onClick={() => {
                setSelected(table.name);
              }}
              title={table.type === "view" ? `${table.name} (view)` : table.name}
              type="button"
            >
              {table.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * SQLite's own values are richer than the grid's strings, so each one is
 * rendered the way a reader would recognise it.
 *
 * NULL passes through as null rather than as an empty string, because those are
 * different answers and the grid draws them differently.
 *
 * A blob is described rather than shown: its bytes are usually an image or a
 * serialized structure, and pasting them through as text produces a cell of
 * replacement characters that is slow to render and tells nobody anything.
 */
function formatValue(value: SqlValue): CellValue {
  if (value === null) {
    return null;
  }
  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return `<${value.length.toLocaleString()} bytes>`;
  }
  if (value instanceof ArrayBuffer) {
    return `<${value.byteLength.toLocaleString()} bytes>`;
  }
  return String(value);
}

function listTables(db: Database): TableInfo[] {
  // `substr` rather than a `NOT LIKE 'sqlite_%'`, whose underscore is itself a
  // wildcard and would need escaping to mean what it looks like it means.
  const rows = db.exec({
    resultRows: [],
    returnValue: "resultRows",
    rowMode: "array",
    sql: `SELECT name, type FROM sqlite_schema
          WHERE type IN ('table', 'view') AND substr(name, 1, 7) <> 'sqlite_'
          ORDER BY type, name`,
  });
  return rows.map((row) => ({
    name: formatValue(row[0] ?? null) ?? "",
    type: row[1] === "view" ? "view" : "table",
  }));
}

/** Escapes a table name for interpolation, since SQLite cannot bind one. */
function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * The declared type of every column, by name.
 *
 * SQLite's types are advisory -- a column declared `INTEGER` can hold a string
 * -- so this drives what is displayed and how it is aligned, never how a value
 * is read back.
 */
function readColumnTypes({ db, table }: { db: Database; table: TableInfo }) {
  const types = new Map<string, string>();
  // `PRAGMA table_info` also answers for views, reporting the types their
  // underlying expressions resolve to.
  const rows = db.exec({
    resultRows: [],
    returnValue: "resultRows",
    rowMode: "array",
    sql: `PRAGMA table_info(${quoteIdentifier(table.name)})`,
  });
  for (const row of rows) {
    const name = typeof row[1] === "string" ? row[1] : null;
    const type = typeof row[2] === "string" ? row[2] : "";
    if (name) {
      types.set(name, type);
    }
  }
  return types;
}

function readTable({ db, table }: { db: Database; table: TableInfo }) {
  const quoted = quoteIdentifier(table.name);
  const columnNames: string[] = [];
  const rows = db.exec({
    columnNames,
    resultRows: [],
    returnValue: "resultRows",
    rowMode: "array",
    sql: `SELECT * FROM ${quoted} LIMIT ${MAX_ROWS}`,
  });

  // Only counted once the read has been capped, so the common case of a small
  // table does not pay for a second pass over it.
  let note: string | undefined;
  if (rows.length === MAX_ROWS) {
    const [total] = db.exec({
      resultRows: [],
      returnValue: "resultRows",
      rowMode: "array",
      sql: `SELECT count(*) FROM ${quoted}`,
    });
    note = `first ${MAX_ROWS.toLocaleString()} of ${Number(total?.[0] ?? 0).toLocaleString()}`;
  }

  const declared = readColumnTypes({ db, table });
  const values = rows.map((row) => row.map(formatValue));

  return {
    columns: columnNames.map<GridColumn>((name, index) => {
      const type = declared.get(name) ?? "";
      return {
        // Declared types are advisory, so a column with none, or one whose
        // values disagree with it, still lands on whatever the data reads as.
        align: NUMERIC_TYPE.test(type)
          ? "right"
          : inferAlignment({ index, rows: values }),
        name,
        type: type || undefined,
      };
    }),
    note,
    rows: values,
  };
}

function TableContents({ db, table }: { db: Database; table: TableInfo }) {
  const { columns, note, rows } = useMemo(
    () => readTable({ db, table }),
    [db, table],
  );

  // The name is passed through even when the tab strip below is showing it,
  // because the strip only appears for a database with more than one table and
  // a single-table file would otherwise never say what it was displaying.
  return (
    <DataGrid
      columns={columns}
      note={note}
      rows={rows}
      title={table.type === "view" ? `${table.name} (view)` : table.name}
    />
  );
}

let sqlitePromise: null | Promise<Sqlite3Static> = null;

type DatabaseState =
  | { db: Database; status: "ready"; tables: TableInfo[] }
  | { error: unknown; status: "error" }
  | { status: "loading" };

/**
 * The wasm module, loaded once per session and shared by every database opened
 * afterwards. A rejected load is dropped rather than cached, so a viewer opened
 * after a transient failure gets a fresh attempt instead of the old error.
 */
async function loadSqlite() {
  // The published types declare the initializer as taking nothing, but it is an
  // Emscripten module factory and reads the standard `locateFile` hook off its
  // argument. Without it the module resolves `sqlite3.wasm` against its own
  // script URL, which under `file://` in production is not fetchable.
  const init = sqlite3InitModule as (options: {
    locateFile: () => string;
  }) => Promise<Sqlite3Static>;

  sqlitePromise ??= init({ locateFile: () => SQLITE_WASM_URL }).catch(
    (error: unknown) => {
      sqlitePromise = null;
      throw error;
    },
  );
  return sqlitePromise;
}

async function openDatabase(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sqlite3 = await loadSqlite();

  const db = new sqlite3.oo1.DB();
  try {
    if (db.pointer === undefined) {
      throw new Error("SQLite could not open a database handle.");
    }
    // `FREEONCLOSE` hands the copy to SQLite so closing the database frees it;
    // without it the bytes stay allocated in wasm memory for the session.
    const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      pointer,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
    );
    if (rc !== 0) {
      throw new Error(`SQLite could not read this file (code ${rc}).`);
    }
    // Deserializing only maps the bytes; nothing has read the header yet, so a
    // file that is not a database at all fails here rather than above.
    listTables(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Opens the database for as long as the viewer is mounted, and closes it after.
 *
 * The handle owns wasm memory the size of the whole file, so it is not left to
 * a cache to release: switching files in the artifact panel would otherwise
 * hold every database opened this session.
 */
function useDatabase(url: string): DatabaseState {
  const [state, setState] = useState<DatabaseState>({ status: "loading" });

  // Switching files puts the viewer back to loading during the render that
  // brought the new url in, rather than from inside the effect below. Done
  // there it would paint the previous database's tables once under the new
  // file's name before the effect had a chance to clear them.
  const [loadedUrl, setLoadedUrl] = useState(url);
  if (loadedUrl !== url) {
    setLoadedUrl(url);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let opened: Database | null = null;
    let cancelled = false;

    void openDatabase(url).then(
      (db) => {
        // The viewer was torn down while the file was still loading, so the
        // database it asked for is closed rather than leaked.
        if (cancelled) {
          db.close();
          return;
        }
        opened = db;
        setState({ db, status: "ready", tables: listTables(db) });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ error, status: "error" });
        }
      },
    );

    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [url]);

  return state;
}
