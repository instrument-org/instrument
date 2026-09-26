import { useAskAboutSelection } from "@/client/components/orchestrator/ask-about-selection";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { logger } from "@/client/lib/logger";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useState } from "react";
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

/** How often an open table looks for the agent's writes. */
const WATCH_INTERVAL_MS = 250;
/** How long editing rests before a save, and the longest a save waits under steady editing. */
const SAVE_DEBOUNCE_MS = 400;
const SAVE_MAX_WAIT_MS = 2000;
const FLASH_MS = 1800;
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

type SaveStatus = "error" | "saved" | "saving" | "unsaved";

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

  if (initial.isLoading) {
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

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => {
      logger.error("csv editor:", error);
      options.onStatus(
        "error",
        error instanceof Error ? error.message : "Could not save",
      );
    });
    return queue;
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueued = false;
  let pendingSince = 0;
  // Debounced, but never postponed past the max wait: a steady stream of
  // edits or agent writes must not keep the person's changes off disk.
  const scheduleSave = (ms = SAVE_DEBOUNCE_MS) => {
    clearTimeout(saveTimer);
    pendingSince ||= Date.now();
    options.onStatus("unsaved");
    saveTimer = setTimeout(
      () => {
        saveTimer = undefined;
        pendingSince = 0;
        if (saveQueued) {
          return;
        }
        saveQueued = true;
        void enqueue(save);
      },
      Math.max(0, Math.min(ms, pendingSince + SAVE_MAX_WAIT_MS - Date.now())),
    );
  };

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      pendingSince = 0;
      if (!saveQueued) {
        saveQueued = true;
        void enqueue(save);
      }
    }
    return queue;
  };

  async function save() {
    saveQueued = false;
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

  let pullQueued = false;
  /** The file changed on disk (or may have): read it and take in what changed. */
  const pull = () => {
    if (pullQueued || destroyed) {
      return;
    }
    pullQueued = true;
    void enqueue(async () => {
      pullQueued = false;
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

  // Leaving is a save: the window hiding or closing.
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      void flush();
    }
  };
  const onUnload = () => {
    void flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("beforeunload", onUnload);

  return {
    apply: (edit: CsvEdit) => {
      apply(edit);
    },
    /** Saves what is unsaved, then stops. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      await flush();
      destroyed = true;
      clearTimeout(saveTimer);
    },
    disk: () => disk,
    doc: () => local,
    flush,
    /** Whether nothing is waiting to be written. */
    idle: async () => {
      await queue;
      return !saveQueued && saveTimer === undefined && local.text === disk.text;
    },
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
  const orchestrator = useContext(OrchestratorContext);
  const askAbout = useAskAboutSelection();

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
          }, FLASH_MS);
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
    if (import.meta.env.DEV) {
      const holder = window as unknown as {
        __csvEditors?: Record<string, CsvSession>;
      };
      holder.__csvEditors ??= {};
      holder.__csvEditors[hostPath] = next;
    }
    return () => {
      clearTimeout(flashTimer);
      void next.destroy();
    };
    // The session is the file's for the component's life; the caller keys the
    // component on the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The file on disk, looked at four times a second while it is open.
  const watched = useQuery({
    ...rpcClient.files.live.info.experimental_liveOptions({
      input: { intervalMs: WATCH_INTERVAL_MS, path: hostPath },
    }),
    enabled: session !== null,
  });
  const modifiedAt = watched.data?.modifiedAt;
  useEffect(() => {
    if (modifiedAt !== undefined) {
      session?.pull();
    }
  }, [modifiedAt, session]);

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

  const ask = (block: GridBlock) => {
    askAbout({ path: hostPath, ...quoteBlock(doc, block, columns) });
  };

  return (
    <DataGrid
      columns={columns}
      editing={editing}
      note={readOnly ?? undefined}
      onAsk={orchestrator ? ask : undefined}
      rows={rows}
    />
  );
}

// ---------------------------------------------------------------- session

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
