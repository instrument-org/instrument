import { WindowContext } from "@/client/components/window/context";
import {
  linesLabel,
  numbered,
  useAskRevealer,
  useFileAsks,
} from "@/client/components/window/staged-asks";
import { useAskCard } from "@/client/components/window/use-ask-card";
import { registerFileFlush } from "@/client/lib/file-flush";
import {
  AGENT_FLASH_MS,
  createSaveQueue,
  flushOnLeave,
  type SaveStatus,
  usePullOnDiskChange,
} from "@/client/lib/live-file";
import { rpcClient } from "@/client/rpc/client";
import { type ReferenceElement } from "@floating-ui/dom";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FileLoading } from "../file-loading";
import { markdownCell } from "./ask-selection-context";
import {
  applyEdit,
  changedCells,
  type CsvDocument,
  type CsvEdit,
  detectDelimiter,
  lastLineOf,
  lineOf,
  parseCsv,
  recordKey,
  replayEdits,
  type ReplayNotes,
  widthOf,
} from "./csv-text";
import {
  type CellValue,
  DataGrid,
  type GridBlock,
  type GridColumn,
  type GridEditing,
} from "./data-grid";
import { inferAlignment } from "./grid-columns";

/**
 * The cell each staged ask on a table starts at, by the ask's id, as a row
 * and column of the data: kept past the table's own life, since the asks
 * outlive a tab switch that unmounts it.
 */
const cellOfAsk = new Map<string, { column: number; row: number }>();

/**
 * Past these a file opens read-only. Every edit reparses the whole file to
 * keep each field's place in it, which stays under a frame's worth of work
 * well past 50,000 rows and stops doing so somewhere beyond these.
 */
const MAX_EDITABLE_ROWS = 100_000;
const MAX_EDITABLE_LENGTH = 16 * 1024 * 1024;
/** Cell edits kept for undo. */
const UNDO_DEPTH = 100;

const NO_FLASH: ReadonlySet<string> = new Set();

type CsvSession = ReturnType<typeof createCsvSession>;

declare global {
  interface Window {
    /** Each open table's session by path, for checks to drive in development. */
    __csvEditors?: Record<string, CsvSession>;
  }
}

/** A batch of cell edits as it can be undone: the cells, and their record's text afterwards. */
type UndoEntry = Extract<CsvEdit, { kind: "cells" }>;

/**
 * A delimited text file open as a table that can be edited in place, saved as
 * it is edited, and following the file as the agent writes it.
 *
 * A save is a splice: the fields that were edited change in the file and
 * nothing else does, so the file keeps its delimiter, its quoting, its line
 * endings, its byte-order mark and its trailing newline (see csv-text.ts).
 * An agent's write lands in place, keeping the scroll and the selection, and
 * lights up the cells it changed; edits not yet saved are made again on top
 * of it.
 */
export function CsvEditor({
  filename,
  hostPath,
}: {
  filename: string;
  hostPath: string;
}) {
  const initial = useQuery({
    ...rpcClient.files.read.queryOptions({ input: { path: hostPath } }),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Another view of the file may have just left its own read in the cache,
  // from before it saved; the document starts from a read of this mount's.
  if (initial.isLoading || !initial.isFetchedAfterMount) {
    return <FileLoading />;
  }
  if (initial.error || !initial.data) {
    throw initial.error ?? new Error("Could not read the file");
  }
  return (
    <LiveTable filename={filename} hostPath={hostPath} initial={initial.data} />
  );
}

/**
 * A block of cells as a reader names it: its rows by the grid's numbers, and
 * its columns by name when it is not every column.
 */
function blockLabel(block: GridBlock, columns: GridColumn[], width: number) {
  const first = block.rows[0] ?? 0;
  const last = block.rows.at(-1) ?? first;
  const runs = block.rows.every((row, index) => row === first + index);
  const rows =
    block.rows.length === 1
      ? `row ${first + 1}`
      : runs
        ? `rows ${first + 1}-${last + 1}`
        : `${block.rows.length} rows`;
  if (block.columns.length === width) {
    return rows;
  }
  const names = block.columns.map(
    (column) => columns[column]?.name || `column ${column + 1}`,
  );
  return `${rows} · ${names.length > 3 ? `${names.length} columns` : names.join(", ")}`;
}

/**
 * One table's disk I/O: edits made to the text as splices, saves debounced
 * and version-checked, and the agent's writes read in with the unsaved edits
 * made again on top. Everything that touches the disk runs through one queue,
 * so a merge never interleaves with a save in flight.
 */
function createCsvSession(options: {
  doc: CsvDocument;
  hostPath: string;
  initial: { content: string; version: string };
  /** The table changed; with the cells to light up when someone else changed them. */
  onChange: (doc: CsvDocument, flashed?: ReadonlySet<string>) => void;
  onNotes: (notes: ReplayNotes) => void;
  onStatus: (status: SaveStatus, detail?: string) => void;
}) {
  const { hostPath } = options;
  let disk = {
    text: options.initial.content,
    version: options.initial.version,
  };
  let local = options.doc;
  // The person's edits since the text on disk, restated against `local`'s
  // history so they can be made again on a version someone else wrote.
  let pending: CsvEdit[] = [];
  const undoStack: UndoEntry[] = [];
  let redoStack: UndoEntry[] = [];
  let destroyed = false;

  const saves = createSaveQueue({
    label: "csv editor",
    onStatus: options.onStatus,
    save,
  });
  const scheduleSave = saves.schedule;

  async function save() {
    const text = local.text;
    if (text === disk.text) {
      pending = [];
      options.onStatus("saved");
      return;
    }
    options.onStatus("saving");
    const sent = pending.length;
    const result = await rpcClient.files.write.call({
      baseVersion: disk.version,
      content: text,
      path: hostPath,
    });
    if (result.ok) {
      disk = { text, version: result.version };
      pending = pending.slice(sent);
      options.onStatus("saved");
      // Edited while the write was in flight.
      if (!destroyed && local.text !== disk.text) {
        scheduleSave();
      }
      return;
    }
    // The file changed since it was last read. Make the edits again on top
    // of it, then save against the new version.
    mergeIn(result.content, result.version);
    scheduleSave(100);
  }

  function mergeIn(content: string, version: string) {
    const before = local;
    const theirs = parseCsv(content, local.delimiter);
    const replayed = replayEdits(theirs, pending);
    disk = { text: content, version };
    pending = replayed.edits;
    local = replayed.doc;
    options.onChange(local, changedCells(before, local));
    options.onNotes(replayed.notes);
    if (local.text !== disk.text) {
      scheduleSave();
    }
  }

  /** The file changed on disk (or may have): read it and take in what changed. */
  const pull = () => {
    if (destroyed) {
      return;
    }
    saves.pull(async () => {
      const result = await rpcClient.files.read.call({ path: hostPath });
      // Our own save's echo.
      if (result.version === disk.version || result.content === disk.text) {
        return;
      }
      mergeIn(result.content, result.version);
    });
  };

  /** Makes one edit on the table as it stands, and saves it. */
  const apply = (edit: CsvEdit) => {
    const notes: ReplayNotes = { byPosition: 0, keptYours: 0, lost: 0 };
    const applied = applyEdit(local, edit, notes);
    if (!applied || applied.text === local.text) {
      return null;
    }
    const before = local;
    local = parseCsv(applied.text, local.delimiter);
    pending.push(applied.edit);
    options.onChange(local);
    scheduleSave();
    return { after: local, before, edit: applied.edit };
  };

  /** The cells of an applied edit, as the edit that puts them back. */
  const inverse = (entry: UndoEntry, after: CsvDocument): UndoEntry => ({
    cells: entry.cells.map((cell) => ({
      ...cell,
      before: cell.value,
      ref: { key: recordKey(after, cell.ref.record), record: cell.ref.record },
      value: cell.before,
    })),
    kind: "cells",
  });

  /** Sets cells, by record in `source`: the table as it was drawn when they were edited. */
  const setCells = (
    source: CsvDocument,
    changes: { column: number; record: number; value: string }[],
  ) => {
    const header = source.values[source.headerRecord] ?? [];
    const cells = changes.flatMap(({ column, record, value }) =>
      record < 0
        ? []
        : [
            {
              before: source.values[record]?.[column] ?? "",
              column,
              header: header[column] ?? "",
              ref: { key: recordKey(source, record), record },
              value,
            },
          ],
    );
    const done = apply({ cells, kind: "cells" });
    if (done?.edit.kind === "cells") {
      undoStack.push(inverse(done.edit, done.after));
      if (undoStack.length > UNDO_DEPTH) {
        undoStack.shift();
      }
      redoStack = [];
    }
  };

  const step = (from: UndoEntry[], to: UndoEntry[]) => {
    const entry = from.pop();
    if (!entry) {
      return;
    }
    const done = apply(entry);
    if (done?.edit.kind === "cells") {
      to.push(inverse(done.edit, done.after));
    }
  };

  const stopFlushOnLeave = flushOnLeave(saves.flush);

  return {
    apply: (edit: CsvEdit) => {
      apply(edit);
    },
    /** Saves what is unsaved, then stops. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      stopFlushOnLeave();
      await saves.flush();
      destroyed = true;
      saves.cancel();
    },
    disk: () => disk,
    doc: () => local,
    flush: saves.flush,
    /** Whether nothing is waiting to be written. */
    idle: async () => (await saves.idle()) && local.text === disk.text,
    pull,
    redo: () => {
      step(redoStack, undoStack);
    },
    setCells,
    undo: () => {
      step(undoStack, redoStack);
    },
  };
}

// ---------------------------------------------------------------- session

function LiveTable({
  filename,
  hostPath,
  initial,
}: {
  filename: string;
  hostPath: string;
  initial: { content: string; version: string };
}) {
  const [doc, setDoc] = useState(() =>
    parseCsv(initial.content, detectDelimiter(filename, initial.content)),
  );
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(NO_FLASH);
  const [session, setSession] = useState<CsvSession | null>(null);
  const readOnly = useMemo(() => readOnlyReason(doc), [doc]);
  const appWindow = useContext(WindowContext);
  const { begin, card } = useAskCard(hostPath);
  // The asks staged on this file, each marked at the cell it starts at.
  const asks = useFileAsks(hostPath);
  const marks = new Map(
    numbered(asks).flatMap(({ ask, n }) => {
      const cell = cellOfAsk.get(ask.id);
      return cell ? [[`${cell.row}:${cell.column}`, n] as const] : [];
    }),
  );
  const revealRef = useRef<
    ((cell: { column: number; row: number }) => void) | null
  >(null);
  useAskRevealer(hostPath, (id) => {
    const cell = cellOfAsk.get(id);
    if (cell) {
      revealRef.current?.(cell);
    }
  });

  useEffect(() => {
    if (readOnlyReason(doc)) {
      return;
    }
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const next = createCsvSession({
      doc,
      hostPath,
      initial,
      onChange: (changed, cells) => {
        setDoc(changed);
        if (cells && cells.size > 0) {
          setFlashed(cells);
          clearTimeout(flashTimer);
          flashTimer = setTimeout(() => {
            setFlashed(NO_FLASH);
          }, AGENT_FLASH_MS);
        }
      },
      onNotes: reportNotes,
      onStatus: (status, detail) => {
        if (status === "error") {
          toast.error("Could not save", { description: detail });
        }
      },
    });
    setSession(next);
    const unregister = registerFileFlush(hostPath, next.flush);
    if (import.meta.env.DEV) {
      window.__csvEditors ??= {};
      window.__csvEditors[hostPath] = next;
    }
    return () => {
      unregister();
      clearTimeout(flashTimer);
      void next.destroy();
    };
    // The session is the file's for the component's life; the caller keys the
    // component on the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullOnDiskChange(hostPath, session, { enabled: session !== null });

  const width = widthOf(doc);
  const header = doc.values[doc.headerRecord] ?? [];
  const rows = useMemo(
    () =>
      doc.rowRecords.map((record): CellValue[] => {
        const values = doc.values[record] ?? [];
        return values.length === width
          ? values
          : Array.from({ length: width }, (_, index) => values[index] ?? "");
      }),
    [doc, width],
  );
  // Kept the same while the names and alignments are, so an edit to a cell
  // does not hand the grid new columns to measure.
  const nextColumns = Array.from(
    { length: width },
    (_, index): GridColumn => ({
      align: inferAlignment({ index, rows }),
      name: header[index] ?? "",
    }),
  );
  const [columns, setColumns] = useState(nextColumns);
  if (
    columns.length !== nextColumns.length ||
    columns.some(
      (column, index) =>
        column.name !== nextColumns.at(index)?.name ||
        column.align !== nextColumns.at(index)?.align,
    )
  ) {
    setColumns(nextColumns);
  }

  const editing: GridEditing | undefined =
    session && !readOnly
      ? {
          flashed,
          onAddColumn: () => {
            session.apply({ kind: "addColumn", name: `Column ${width + 1}` });
          },
          // Rows are the ones on screen, found again in the session's table
          // by their text, in case the agent wrote since they were drawn.
          onChange: (changes) => {
            session.setCells(
              doc,
              changes.map(({ column, row, value }) => ({
                column,
                record: doc.rowRecords[row] ?? -1,
                value,
              })),
            );
          },
          onDeleteRows: (picked) => {
            session.apply({
              kind: "deleteRows",
              refs: picked.flatMap((row) => {
                const record = doc.rowRecords[row];
                return record === undefined
                  ? []
                  : [{ key: recordKey(doc, record), record }];
              }),
            });
          },
          onInsertRow: (row, where) => {
            const record = doc.rowRecords[row];
            if (record !== undefined) {
              session.apply({
                kind: "insertRow",
                ref: { key: recordKey(doc, record), record },
                where,
              });
            }
          },
          onRedo: () => {
            session.redo();
          },
          onRenameColumn: (column, name) => {
            session.setCells(doc, [
              { column, record: doc.headerRecord, value: name },
            ]);
          },
          onUndo: () => {
            session.undo();
          },
        }
      : undefined;

  const ask = (block: GridBlock, reference: ReferenceElement) => {
    const { lines, quote } = quoteBlock(doc, block, columns);
    const first = { column: block.columns[0], row: block.rows[0] };
    begin({
      excerpt: quote,
      onStaged: (id) => {
        if (first.column !== undefined && first.row !== undefined) {
          cellOfAsk.set(id, { column: first.column, row: first.row });
        }
      },
      reference,
      target: [
        blockLabel(block, columns, width),
        ...(lines ? [linesLabel(lines)] : []),
      ].join(" · "),
    });
  };

  return (
    <>
      <DataGrid
        columns={columns}
        editing={editing}
        marks={marks}
        note={readOnly ?? undefined}
        onAsk={appWindow ? ask : undefined}
        revealRef={revealRef}
        rows={rows}
      />
      {card}
    </>
  );
}

/**
 * A block of cells as the quote a question starts from: a small Markdown
 * table with the grid's row numbers and the column names, and the lines of
 * the file it covers when the rows run on from each other there.
 */
function quoteBlock(
  doc: CsvDocument,
  block: GridBlock,
  columns: GridColumn[],
): { lines?: [number, number]; quote: string } {
  const names = block.columns.map((column) => columns[column]?.name ?? "");
  const lines = [
    `| Row | ${names.map(markdownCell).join(" | ")} |`,
    `| --- | ${names.map(() => "---").join(" | ")} |`,
    ...block.rows.map((row) => {
      const values = doc.values[doc.rowRecords[row] ?? -1] ?? [];
      return `| ${row + 1} | ${block.columns.map((column) => markdownCell(values[column] ?? "")).join(" | ")} |`;
    }),
  ];
  const first = block.rows[0];
  const last = block.rows.at(-1);
  const runs =
    first !== undefined &&
    last !== undefined &&
    block.rows.every((row, index) => row === first + index);
  if (!runs) {
    return { quote: lines.join("\n") };
  }
  const firstRecord = doc.rowRecords[first] ?? 0;
  const lastRecord = doc.rowRecords[last] ?? 0;
  const from = lineOf(doc, firstRecord);
  const to = lastLineOf(
    doc,
    lastRecord,
    firstRecord === lastRecord ? from : lineOf(doc, lastRecord),
  );
  return { lines: [from, to], quote: lines.join("\n") };
}

/** Why a file opens read-only, or null when it can be edited. */
function readOnlyReason(doc: CsvDocument) {
  if (doc.text.includes("�")) {
    return "read-only: not UTF-8 text";
  }
  if (
    doc.rowRecords.length > MAX_EDITABLE_ROWS ||
    doc.text.length > MAX_EDITABLE_LENGTH
  ) {
    return `read-only above ${MAX_EDITABLE_ROWS.toLocaleString()} rows`;
  }
  return null;
}

function reportNotes(notes: ReplayNotes) {
  if (notes.keptYours > 0) {
    toast.message("Kept your version", {
      description:
        notes.keptYours === 1
          ? "The agent also changed a cell you edited; yours was kept."
          : `The agent also changed ${notes.keptYours} cells you edited; yours were kept.`,
    });
  }
  if (notes.byPosition > 0) {
    toast.message("Placed your edits by position", {
      description:
        "The agent changed the rows or columns you edited, so your edits were matched by row number and column name.",
    });
  }
  if (notes.lost > 0) {
    toast.message("Some edits were not applied", {
      description:
        "The agent removed or changed rows you edited or deleted before your change was saved.",
    });
  }
}
