import { logger } from "@/client/lib/logger";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { ColumnsIcon } from "@phosphor-icons/react/Columns";
import {
  type Column,
  type ColumnDef,
  type ColumnSizingState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "../ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { MenuScrollArea } from "../ui/menu-scroll-area";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { AskButton } from "./ask-selection";
import { tableClipboardItem, type TableCopyFormat } from "./table-clipboard";
import { TABLE_COPY_ALTERNATES } from "./table-copy-formats";
import { TableCopyMenu } from "./table-copy-menu";
import { useCopyShortcut } from "./use-copy-shortcut";
import { ViewerToolbar, ViewerToolbarSpacer } from "./viewer-toolbar";
import "./data-grid.css";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 30;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 420;
// Columns are sized from a sample rather than every row so a million-row table
// does not pay a full scan before first paint.
const WIDTH_SAMPLE_ROWS = 200;
const CHARACTER_WIDTH = 7.2;
const CELL_PADDING = 24;

/**
 * A cell's display text, or `null` for a value that is genuinely absent.
 *
 * The distinction is not decoration: in a database `NULL` and the empty string
 * are different answers, and a grid that renders both as blank silently loses
 * which one it was looking at.
 */
export type CellValue = null | string;

/** A block of cells, by index into the grid's `rows` and `columns`, in the order shown. */
export interface GridBlock {
  columns: number[];
  rows: number[];
}

export interface GridColumn {
  /** Right, for columns whose values are numbers, so the digits line up. */
  align?: "left" | "right";
  name: string;
  /** The source's own type name, where it has one, shown beside the header. */
  type?: string;
}

/**
 * What a grid whose file can be written lets the reader do to it. Rows and
 * columns are indexes into the grid's own `rows` and `columns`, whatever
 * sort or filter is on screen.
 */
export interface GridEditing {
  /** Cells someone else just changed, as `row:column`, or `h:column` for a header, to light up. */
  flashed: ReadonlySet<string>;
  onAddColumn: () => void;
  /** Cells changed from the grid: typed, cleared or pasted. */
  onChange: (changes: { column: number; row: number; value: string }[]) => void;
  onDeleteRows: (rows: number[]) => void;
  onInsertRow: (row: number, where: "above" | "below") => void;
  onRedo: () => void;
  onRenameColumn: (column: number, name: string) => void;
  onUndo: () => void;
}

interface CellPosition {
  column: number;
  row: number;
}

/** A cell open for typing, by its place on screen; row -1 is the header. */
interface EditingCell extends CellPosition {
  draft: string;
}

/**
 * The tabular body shared by every viewer whose content is rows and columns:
 * delimited text, database tables, Parquet and line-delimited JSON.
 *
 * This is a reader, not a data tool. It shows a table, lets someone find a row
 * and take the values away, and stops there. Sorting, filtering and the row
 * model come from `@tanstack/react-table`; what is written here is the part no
 * headless table can give you, which is how the cells are drawn and how a
 * selection is built across them.
 *
 * It takes the whole table rather than a windowing callback. Every caller
 * already holds its rows in memory, and sorting and filtering are answered
 * across the entire set rather than the visible slice, so a paging interface
 * here would relocate that work without shrinking it.
 *
 * Rows and columns are both windowed. Columns matter as much as rows here: a
 * `SELECT *` across a wide table renders every column of every visible row, so
 * without it a forty-column export costs more per frame than a long one does.
 */
export function DataGrid({
  columns,
  editing: edit,
  note,
  onAsk,
  rows,
  title,
}: {
  columns: GridColumn[];
  /** Makes cells editable, for a file this surface can write. */
  editing?: GridEditing;
  note?: string;
  /** Offers the selected block to Instrument, with a button over it. */
  onAsk?: (block: GridBlock) => void;
  rows: CellValue[][];
  title?: string;
}) {
  // `useReactTable` holds a mutable instance across renders, which the compiler
  // cannot memoize safely. See TanStack/table#6137.
  "use no memo";

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  // Whether a copy of part of the grid carries the column names. On for the
  // formats that are unreadable without them, and a setting rather than a
  // second row of menu items, which is what the pair of Copy entries this
  // replaced had become.
  const [copyHeaders, setCopyHeaders] = useState(true);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [selection, setSelection] = useState<null | {
    anchor: CellPosition;
    focus: CellPosition;
  }>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  // Whether a pointer is building a selection, so the Ask button waits for
  // the drag to finish rather than chasing it.
  const [dragging, setDragging] = useState(false);

  // Held as state rather than a ref because both virtualizers and the copy
  // shortcut need it, and they need it on a render rather than whenever the
  // ref happens to be filled. `setGrid` is a stable identity, which matters:
  // an inline callback ref is a new function every render, so React detaches
  // and reattaches it each time, and the virtualizers can read the null.
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);

  const measured = useMemo(
    () => measureColumns({ columns, rows }),
    [columns, rows],
  );

  const columnDefs = useMemo<ColumnDef<CellValue[]>[]>(
    () =>
      columns.map((column, index) => ({
        // Blank and absent are the same thing to sort and filter, and both are
        // reported as undefined because that is the only value `sortUndefined`
        // recognizes. What a cell displays is read off the row itself, so the
        // difference between an empty string and NULL survives for the reader.
        accessorFn: (row) => {
          const value = row[index];
          return value === null || value === undefined || value === ""
            ? undefined
            : value;
        },
        header: column.name,
        id: String(index),
        size: measured[index] ?? MIN_COLUMN_WIDTH,
        sortingFn: compareCells,
        // Pins blanks to the end whichever way the column is sorted. A
        // comparator cannot do this itself: a descending sort negates whatever
        // it returns, so deliberate blanks-last becomes blanks-first.
        sortUndefined: "last",
      })),
    [columns, measured],
  );

  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({
    columnResizeMode: "onChange",
    columns: columnDefs,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: containsText,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    state: {
      columnSizing,
      columnVisibility,
      globalFilter,
      sorting,
    },
  });

  // Resize handlers hang off headers rather than columns, and the rows below
  // are rendered from columns, so the pair is bridged once here rather than
  // searched per header per frame.
  const headersById = new Map(
    table.getFlatHeaders().map((header) => [header.column.id, header]),
  );

  const visibleRows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => grid,
    overscan: 12,
  });

  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    estimateSize: (index) =>
      visibleColumns[index]?.getSize() ?? MIN_COLUMN_WIDTH,
    getScrollElement: () => grid,
    horizontal: true,
    overscan: 3,
  });

  // The virtualizer measures each column once and caches it, and a new
  // `estimateSize` closure is not what invalidates that cache. Without this, a
  // resize drag changes every cell's width while leaving the offsets they are
  // placed at describing the old ones, so the columns to the right overlap.
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnSizing, columnVirtualizer]);

  const totalWidth = columnVirtualizer.getTotalSize();

  const selectedRange = resolveRange({
    columnCount: visibleColumns.length,
    rowCount: visibleRows.length,
    selection,
  });

  const readSelection = (withHeaders: boolean) => {
    if (!selectedRange) {
      return null;
    }
    const taken = visibleColumns.slice(
      selectedRange.firstColumn,
      selectedRange.lastColumn + 1,
    );
    const block: string[][] = [];
    if (withHeaders) {
      block.push(taken.map((column) => columns[Number(column.id)]?.name ?? ""));
    }
    for (
      let row = selectedRange.firstRow;
      row <= selectedRange.lastRow;
      row += 1
    ) {
      const record = visibleRows[row];
      if (!record) {
        continue;
      }
      block.push(
        // A copied `NULL` goes out as nothing rather than the four letters,
        // which would paste as a string that happens to spell it.
        taken.map((column) => String(record.getValue(column.id) ?? "")),
      );
    }
    return block;
  };

  // Everything the reader can currently see, headers first: the sort and the
  // filter they set up are part of what they are copying, and a hidden column
  // is one they have said they do not want.
  const readTable = () => [
    visibleColumns.map((column) => columns[Number(column.id)]?.name ?? ""),
    ...visibleRows.map((record) =>
      visibleColumns.map((column) => String(record.getValue(column.id) ?? "")),
    ),
  ];

  // The grid is a stack of divs rather than a real table, and text selection is
  // off across it, so the browser has no selection of its own to copy and its
  // menu would offer nothing. Both the shortcut and the menu below are what
  // make a selection reachable at all.
  useCopyShortcut({
    container: grid,
    // A cell open for typing copies its own text, as any text field does.
    onCopy: () => !editing && copyBlock(readSelection(copyHeaders)),
  });

  const extendTo = (position: CellPosition, extend: boolean) => {
    setSelection((current) =>
      extend && current
        ? { anchor: current.anchor, focus: position }
        : { anchor: position, focus: position },
    );
  };

  /** The selected block, by index into `rows` and `columns`. */
  const selectedBlock = (): GridBlock | null => {
    if (!selectedRange) {
      return null;
    }
    const taken = visibleColumns.slice(
      selectedRange.firstColumn,
      selectedRange.lastColumn + 1,
    );
    const block: GridBlock = {
      columns: taken.map((column) => Number(column.id)),
      rows: [],
    };
    for (
      let row = selectedRange.firstRow;
      row <= selectedRange.lastRow;
      row += 1
    ) {
      const record = visibleRows[row];
      if (record) {
        block.rows.push(record.index);
      }
    }
    return block;
  };

  /** What a cell on screen holds, by its place on screen; row -1 is the header. */
  const valueAt = ({ column, row }: CellPosition) => {
    const id = visibleColumns[column]?.id;
    if (id === undefined) {
      return "";
    }
    return row === -1
      ? (columns[Number(id)]?.name ?? "")
      : (visibleRows[row]?.original[Number(id)] ?? "");
  };

  const scrollToCell = ({ column, row }: CellPosition) => {
    if (row >= 0) {
      rowVirtualizer.scrollToIndex(row);
    }
    columnVirtualizer.scrollToIndex(column);
  };

  const startEdit = (position: CellPosition, typed?: string) => {
    if (!edit || !visibleColumns[position.column]) {
      return;
    }
    if (position.row !== -1 && !visibleRows[position.row]) {
      return;
    }
    scrollToCell(position);
    setEditing({ ...position, draft: typed ?? valueAt(position) });
  };

  /**
   * Writes the open cell back if it changed, then steps the selection the way
   * the key that closed it asks: Enter down, Tab across, shifted the other way.
   */
  const commitEdit = (move?: { column: number; row: number }) => {
    if (!editing || !edit) {
      return;
    }
    const { column, draft, row } = editing;
    setEditing(null);
    const id = visibleColumns[column]?.id;
    if (id !== undefined && draft !== valueAt(editing)) {
      if (row === -1) {
        edit.onRenameColumn(Number(id), draft);
      } else {
        const record = visibleRows[row];
        if (record) {
          edit.onChange([
            { column: Number(id), row: record.index, value: draft },
          ]);
        }
      }
    }
    if (move) {
      const target = {
        column: Math.min(
          Math.max(column + move.column, 0),
          visibleColumns.length - 1,
        ),
        row: Math.min(
          Math.max(Math.max(row, 0) + move.row, 0),
          visibleRows.length - 1,
        ),
      };
      extendTo(target, false);
      scrollToCell(target);
    }
    grid?.focus({ preventScroll: true });
  };

  /** Empties every selected cell, as Delete does in a spreadsheet. */
  const clearSelection = () => {
    const block = selectedBlock();
    if (!block || !edit) {
      return;
    }
    const changes = block.rows.flatMap((row) =>
      block.columns.flatMap((column) =>
        (rows[row]?.[column] ?? "") === "" ? [] : [{ column, row, value: "" }],
      ),
    );
    if (changes.length > 0) {
      edit.onChange(changes);
    }
  };

  /**
   * Pastes tab-separated text (what a spreadsheet or this grid copies) from
   * the focused cell rightwards and down, over the rows as they are sorted
   * and filtered on screen.
   */
  const pasteText = (text: string) => {
    const at = selection?.focus;
    if (!edit || !at) {
      return;
    }
    const block = Papa.parse<string[]>(text.replace(/\r?\n$/, ""), {
      delimiter: "\t",
    }).data;
    const changes: { column: number; row: number; value: string }[] = [];
    for (const [rowOffset, values] of block.entries()) {
      const record = visibleRows[at.row + rowOffset];
      for (const [columnOffset, value] of values.entries()) {
        const id = visibleColumns[at.column + columnOffset]?.id;
        if (record && id !== undefined) {
          changes.push({ column: Number(id), row: record.index, value });
        }
      }
    }
    if (changes.length > 0) {
      edit.onChange(changes);
    }
  };

  /**
   * The keys that edit rather than move: Enter or F2 opens the focused cell,
   * typing opens it on what was typed, Delete empties the selection, and the
   * platform's undo and redo take back cell edits. Reports whether it acted.
   */
  const editKey = (event: KeyboardEvent<HTMLDivElement>, at: CellPosition) => {
    if (!edit) {
      return false;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        edit.onRedo();
      } else {
        edit.onUndo();
      }
      return true;
    }
    if (!selection) {
      return false;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit(at);
      return true;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = {
        column: Math.min(
          Math.max(at.column + (event.shiftKey ? -1 : 1), 0),
          visibleColumns.length - 1,
        ),
        row: at.row,
      };
      extendTo(target, false);
      scrollToCell(target);
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearSelection();
      return true;
    }
    if (event.key.length === 1 && !mod && !event.altKey) {
      event.preventDefault();
      startEdit(at, event.key);
      return true;
    }
    return false;
  };

  /**
   * Moves the focused cell, extending the block from its anchor when shift is
   * held. `role="grid"` promises this, and without it there is no way to build
   * a selection, and so no way to reach the copy shortcut, without a pointer.
   */
  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (visibleRows.length === 0 || visibleColumns.length === 0) {
      return;
    }
    const from = selection?.focus ?? { column: 0, row: 0 };
    let to: CellPosition;

    if (edit && editKey(event, from)) {
      return;
    }

    switch (event.key) {
      case "ArrowDown": {
        to = { column: from.column, row: from.row + 1 };
        break;
      }
      case "ArrowLeft": {
        to = { column: from.column - 1, row: from.row };
        break;
      }
      case "ArrowRight": {
        to = { column: from.column + 1, row: from.row };
        break;
      }
      case "ArrowUp": {
        to = { column: from.column, row: from.row - 1 };
        break;
      }
      // Home and End run along the row on their own, and to the corners of the
      // whole table with the platform modifier, as a spreadsheet does.
      case "End": {
        to = {
          column: visibleColumns.length - 1,
          row:
            event.ctrlKey || event.metaKey ? visibleRows.length - 1 : from.row,
        };
        break;
      }
      case "Home": {
        to = { column: 0, row: event.ctrlKey || event.metaKey ? 0 : from.row };
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();

    // With nothing selected yet the first press lands on the first cell rather
    // than stepping off it, since there is nothing to step from.
    const target = selection
      ? {
          column: Math.min(Math.max(to.column, 0), visibleColumns.length - 1),
          row: Math.min(Math.max(to.row, 0), visibleRows.length - 1),
        }
      : { column: 0, row: 0 };

    extendTo(target, event.shiftKey);
    rowVirtualizer.scrollToIndex(target.row);
    columnVirtualizer.scrollToIndex(target.column);
  };

  const filtered = visibleRows.length !== rows.length;

  const block = selectedBlock();
  const askable =
    onAsk !== undefined &&
    !editing &&
    !dragging &&
    block !== null &&
    block.rows.length * block.columns.length > 1;
  // The button stands over the selected cells that are drawn, and follows
  // them as the grid scrolls.
  const askReference = useMemo(
    () => ({
      contextElement: grid ?? undefined,
      getBoundingClientRect: () => {
        const cells = grid?.querySelectorAll(
          '[role="gridcell"][aria-selected="true"]',
        );
        const bounds = grid?.getBoundingClientRect() ?? new DOMRect();
        if (!cells || cells.length === 0) {
          return new DOMRect(bounds.left, bounds.top, 0, 0);
        }
        let top = Infinity;
        let left = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const cell of cells) {
          const box = cell.getBoundingClientRect();
          top = Math.min(top, box.top);
          left = Math.min(left, box.left);
          right = Math.max(right, box.right);
          bottom = Math.max(bottom, box.bottom);
        }
        // Clamped to the grid, so a block scrolled partly out of view keeps
        // its button inside the panel.
        top = Math.max(top, bounds.top + HEADER_HEIGHT);
        return new DOMRect(left, top, right - left, Math.max(bottom - top, 0));
      },
    }),
    [grid],
  );

  // A pointer held over the grid is a selection being built; it ends
  // wherever the button is let go.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onUp = () => {
      setDragging(false);
    };
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  const editingLeft = editing
    ? (columnVirtualizer.measurementsCache[editing.column]?.start ?? 0)
    : 0;
  const editingWidth = editing
    ? (visibleColumns[editing.column]?.getSize() ?? MIN_COLUMN_WIDTH)
    : 0;

  const emptyState = describeEmptyGrid({
    clearFilter: () => {
      setGlobalFilter("");
    },
    rowCount: rows.length,
    showAllColumns: () => {
      table.resetColumnVisibility();
    },
    visibleColumnCount: visibleColumns.length,
    visibleRowCount: visibleRows.length,
  });

  return (
    <>
      <ViewerToolbar>
        <span className="px-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {title && <span className="text-foreground">{title}</span>}
          {title && " · "}
          {filtered
            ? `${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()}`
            : rows.length.toLocaleString()}{" "}
          {rows.length === 1 ? "row" : "rows"}
          {note ? ` (${note})` : ""}
        </span>
        <ViewerToolbarSpacer />
        <Input
          aria-label="Filter rows"
          className="h-7 w-40 text-xs"
          onChange={(event) => {
            setGlobalFilter(event.target.value);
          }}
          placeholder="Filter rows"
          value={globalFilter}
        />
        <TableCopyMenu
          onCopy={(format) => {
            copyBlock(readTable(), format);
          }}
        />
        <ColumnMenu columns={columns} table={table} />
      </ViewerToolbar>

      {emptyState ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">{emptyState.text}</p>
          {emptyState.label && (
            <Button onClick={emptyState.onAct} size="sm" variant="outline">
              {emptyState.label}
            </Button>
          )}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              // `select-none` because a drag has to mean one thing. Without it a
              // drag across cells builds the grid's range and the browser's own
              // text selection at the same time, and since the copy shortcut
              // answers with the range, what the reader can see highlighted is
              // not what lands on their clipboard.
              className="min-h-0 flex-1 overflow-auto outline-none select-none focus-visible:outline-[2px] focus-visible:-outline-offset-2 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]"
              onKeyDown={moveSelection}
              onPaste={(event) => {
                if (edit && !editing) {
                  event.preventDefault();
                  pasteText(event.clipboardData.getData("text/plain"));
                }
              }}
              onPointerDown={(event) => {
                if (event.button === 0) {
                  setDragging(true);
                }
                // A click elsewhere in the grid closes the open cell, which
                // blurring it writes back.
                if (
                  !(
                    event.target instanceof HTMLElement &&
                    event.target.closest("[data-grid-editor]")
                  )
                ) {
                  grid?.focus({ preventScroll: true });
                }
              }}
              ref={setGrid}
              role="grid"
              tabIndex={0}
            >
              <div
                className="relative text-[0.8125rem]"
                style={{
                  height: rowVirtualizer.getTotalSize() + HEADER_HEIGHT,
                  width: totalWidth,
                }}
              >
                <div
                  className="sticky top-0 z-20 bg-card"
                  role="row"
                  style={{ height: HEADER_HEIGHT }}
                >
                  {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
                    const column = visibleColumns[virtualColumn.index];
                    return column ? (
                      <HeaderCell
                        column={column}
                        flash={edit?.flashed.has(`h:${column.id}`) ?? false}
                        key={column.id}
                        left={virtualColumn.start}
                        onResize={headersById
                          .get(column.id)
                          ?.getResizeHandler()}
                        spec={columns[Number(column.id)]}
                      />
                    ) : null;
                  })}
                </div>

                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const record = visibleRows[virtualRow.index];
                  if (!record) {
                    return null;
                  }
                  return (
                    <div
                      className={cn(
                        // `top-0` matters: without it an absolutely positioned
                        // row falls back to its static position, which is below
                        // the header already in flow, and the header offset in
                        // the transform below is then counted a second time.
                        "absolute inset-x-0 top-0",
                        virtualRow.index % 2 === 1 && "bg-muted/30",
                      )}
                      key={record.id}
                      role="row"
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start + HEADER_HEIGHT}px)`,
                      }}
                    >
                      {columnVirtualizer
                        .getVirtualItems()
                        .map((virtualColumn) => {
                          const column = visibleColumns[virtualColumn.index];
                          if (!column) {
                            return null;
                          }
                          const position = {
                            column: virtualColumn.index,
                            row: virtualRow.index,
                          };
                          return (
                            <BodyCell
                              align={columns[Number(column.id)]?.align}
                              flash={
                                edit?.flashed.has(
                                  `${record.index}:${column.id}`,
                                ) ?? false
                              }
                              key={column.id}
                              left={virtualColumn.start}
                              onEdit={edit ? startEdit : undefined}
                              onSelect={extendTo}
                              position={position}
                              selected={inRange(selectedRange, position)}
                              value={record.original[Number(column.id)] ?? null}
                              width={column.getSize()}
                            />
                          );
                        })}
                    </div>
                  );
                })}

                {editing && (
                  <CellEditor
                    draft={editing.draft}
                    height={ROW_HEIGHT}
                    left={editingLeft}
                    onCancel={() => {
                      setEditing(null);
                      grid?.focus({ preventScroll: true });
                    }}
                    onChange={(draft) => {
                      setEditing({ ...editing, draft });
                    }}
                    onCommit={commitEdit}
                    top={
                      editing.row === -1
                        ? (grid?.scrollTop ?? 0)
                        : editing.row * ROW_HEIGHT + HEADER_HEIGHT
                    }
                    width={editingWidth}
                  />
                )}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {onAsk && (
              <>
                <ContextMenuItem
                  disabled={!block}
                  onSelect={() => {
                    if (block) {
                      onAsk(block);
                    }
                  }}
                >
                  Ask Instrument
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              disabled={!selectedRange}
              onSelect={() => {
                copyBlock(readSelection(copyHeaders));
              }}
            >
              Copy selection
            </ContextMenuItem>
            {TABLE_COPY_ALTERNATES.map(({ format, label }) => (
              <ContextMenuItem
                disabled={!selectedRange}
                key={format}
                onSelect={() => {
                  copyBlock(readSelection(copyHeaders), format);
                }}
              >
                {label}
              </ContextMenuItem>
            ))}
            <ContextMenuCheckboxItem
              checked={copyHeaders}
              onSelect={(event) => {
                // Kept open: this is a setting for the item the reader is
                // about to pick, not an action of its own.
                event.preventDefault();
                setCopyHeaders(!copyHeaders);
              }}
            >
              Include headers
            </ContextMenuCheckboxItem>
            {edit && (
              <GridEditMenuItems
                block={block}
                columnName={(column) => columns[column]?.name ?? ""}
                edit={edit}
                onEdit={() => {
                  if (selection) {
                    startEdit(selection.focus);
                  }
                }}
                onRename={() => {
                  if (selection) {
                    startEdit({ column: selection.focus.column, row: -1 });
                  }
                }}
              />
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                setSelection(null);
                setGlobalFilter("");
                setSorting([]);
              }}
            >
              Reset sort and filter
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {askable && (
        <AskButton
          onAsk={() => {
            onAsk(block);
            // Asked, so the button goes; the cell the selection ended on stays.
            setSelection((current) =>
              current ? { anchor: current.focus, focus: current.focus } : null,
            );
          }}
          onDismiss={() => {
            setSelection(null);
          }}
          reference={askReference}
        />
      )}
    </>
  );
}

function BodyCell({
  align,
  flash,
  left,
  onEdit,
  onSelect,
  position,
  selected,
  value,
  width,
}: {
  align?: "left" | "right";
  flash: boolean;
  left: number;
  onEdit?: (position: CellPosition) => void;
  onSelect: (position: CellPosition, extend: boolean) => void;
  position: CellPosition;
  selected: boolean;
  value: CellValue;
  width: number;
}) {
  return (
    <div
      aria-selected={selected}
      className={cn(
        "absolute top-0 h-full truncate border-r border-b border-border/40 px-2 py-1",
        align === "right" && "text-right tabular-nums",
        selected && "bg-brand-500/25",
        flash && "animate-[grid-flash_1.6s_ease-out]",
      )}
      onDoubleClick={
        onEdit
          ? () => {
              onEdit(position);
            }
          : undefined
      }
      onPointerDown={(event) => {
        // Right-click keeps whatever is already selected when it lands inside
        // it, so "Copy" in the menu copies the block the user built rather
        // than collapsing it to the one cell they happened to aim at.
        if (event.button === 2 && selected) {
          return;
        }
        onSelect(position, event.shiftKey);
      }}
      onPointerEnter={(event) => {
        // Buttons is a bitmask of what is currently held, so this extends only
        // during a drag rather than on any pointer that crosses the cell.
        if (event.buttons === 1) {
          onSelect(position, true);
        }
      }}
      role="gridcell"
      style={{ left, width }}
      title={value ?? undefined}
    >
      {value ?? <span className="text-muted-foreground/60 italic">NULL</span>}
    </div>
  );
}

/**
 * The open cell: a text box laid over it, as wide as its column and growing
 * with its lines. Enter and Tab write it back and move on (shifted, the other
 * way), Option+Enter starts a new line in it, Escape leaves it as it was, and
 * leaving it any other way writes it back where it stands.
 */
function CellEditor({
  draft,
  height,
  left,
  onCancel,
  onChange,
  onCommit,
  top,
  width,
}: {
  draft: string;
  height: number;
  left: number;
  onCancel: () => void;
  onChange: (draft: string) => void;
  onCommit: (move?: { column: number; row: number }) => void;
  top: number;
  width: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Set when a key has already closed the cell, so the blur that follows
  // does not write it a second time.
  const closed = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  const lines = Math.min(draft.split("\n").length, 8);

  return (
    <textarea
      aria-label="Cell"
      className="absolute z-30 resize-none rounded-xs bg-background px-2 py-1 leading-5 shadow-md outline-2 -outline-offset-1 outline-ring"
      data-grid-editor
      onBlur={() => {
        if (!closed.current) {
          closed.current = true;
          onCommit();
        }
      }}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        // Kept from the grid, whose keys move the selection.
        event.stopPropagation();
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closed.current = true;
          onCancel();
          return;
        }
        if (event.key === "Enter" && event.altKey) {
          event.preventDefault();
          const element = event.currentTarget;
          const { selectionEnd, selectionStart, value } = element;
          onChange(
            `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`,
          );
          requestAnimationFrame(() => {
            element.setSelectionRange(selectionStart + 1, selectionStart + 1);
          });
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          closed.current = true;
          const step = event.shiftKey ? -1 : 1;
          onCommit(
            event.key === "Enter"
              ? { column: 0, row: step }
              : { column: step, row: 0 },
          );
        }
      }}
      ref={ref}
      spellCheck={false}
      style={{
        height: Math.max(height, lines * 20 + 8),
        left,
        minWidth: Math.max(width, 160),
        top,
      }}
      value={draft}
    />
  );
}

function ColumnMenu({
  columns,
  table,
}: {
  columns: GridColumn[];
  table: ReturnType<typeof useReactTable<CellValue[]>>;
}) {
  "use no memo";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Columns"
              className={toolbarClassName({
                className: "size-7",
                pressed: false,
              })}
              size="icon-sm"
              variant="ghost"
            >
              <ColumnsIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Columns</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="flex flex-col p-0">
        <MenuScrollArea className="max-h-80">
          {table.getAllLeafColumns().map((column) => (
            <DropdownMenuCheckboxItem
              checked={column.getIsVisible()}
              key={column.id}
              onSelect={(event) => {
                // Kept open so several columns can be turned off in one visit.
                event.preventDefault();
                column.toggleVisibility();
              }}
            >
              <span className="truncate">
                {columns[Number(column.id)]?.name ?? column.id}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </MenuScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compares two cells as numbers when both read as numbers and as text
 * otherwise, so a column of counts does not sort 10 before 9.
 *
 * Blanks never reach here. The accessor reports them as undefined and
 * `sortUndefined` keeps them at the end whichever way the column is sorted,
 * which is not something a comparator can arrange for itself.
 */
function compareCells(
  first: { getValue: (id: string) => unknown },
  second: { getValue: (id: string) => unknown },
  columnId: string,
) {
  const left = first.getValue(columnId);
  const right = second.getValue(columnId);
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";

  if (leftText === rightText) {
    return 0;
  }
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return leftText.localeCompare(rightText);
}

function containsText(
  row: { getValue: (id: string) => unknown },
  columnId: string,
  query: string,
) {
  if (query === "") {
    return true;
  }
  const value = row.getValue(columnId);
  return (
    typeof value === "string" &&
    value.toLowerCase().includes(query.toLowerCase())
  );
}

/**
 * Puts a block of cells on the clipboard, reporting whether there was anything
 * to write. The caller uses that answer to decide whether it has handled the
 * keystroke or should let the browser have it.
 */
function copyBlock(block: null | string[][], format?: TableCopyFormat) {
  if (!block || block.length === 0) {
    return false;
  }
  navigator.clipboard
    .write([tableClipboardItem(block, format)])
    .catch((error: unknown) => {
      logger.error("Copying the selection failed", error);
    });
  return true;
}

/**
 * What to tell the reader when the grid has nothing to draw, or null when it
 * has something.
 *
 * Keeping the three apart matters more than it looks. An empty table is the
 * file, and nothing can be done about it. The other two are states the reader
 * put the grid into, and unless something names them a hidden last column or an
 * unmatched filter reads as a viewer that broke, with the way back out of it
 * invisible.
 */
function describeEmptyGrid({
  clearFilter,
  rowCount,
  showAllColumns,
  visibleColumnCount,
  visibleRowCount,
}: {
  clearFilter: () => void;
  rowCount: number;
  showAllColumns: () => void;
  visibleColumnCount: number;
  visibleRowCount: number;
}): null | { label?: string; onAct?: () => void; text: string } {
  // Emptiness is checked before hidden columns because a file with nothing in
  // it has no columns either, and reporting that as columns the reader hid
  // offers them a button that cannot put back what was never there.
  if (rowCount === 0) {
    return { text: "This table has no rows." };
  }
  if (visibleColumnCount === 0) {
    return {
      label: "Show all columns",
      onAct: showAllColumns,
      text: "Every column is hidden.",
    };
  }
  if (visibleRowCount === 0) {
    return {
      label: "Clear filter",
      onAct: clearFilter,
      text: "No rows match the filter.",
    };
  }
  return null;
}

/** What a writable grid's menu adds: editing the cell, and rows and columns. */
function GridEditMenuItems({
  block,
  columnName,
  edit,
  onEdit,
  onRename,
}: {
  block: GridBlock | null;
  columnName: (column: number) => string;
  edit: GridEditing;
  onEdit: () => void;
  onRename: () => void;
}) {
  const firstRow = block?.rows[0];
  const lastRow = block?.rows.at(-1);
  const firstColumn = block?.columns[0];
  const rowCount = block?.rows.length ?? 0;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!block} onSelect={onEdit}>
        Edit cell
      </ContextMenuItem>
      <ContextMenuItem
        disabled={firstRow === undefined}
        onSelect={() => {
          if (firstRow !== undefined) {
            edit.onInsertRow(firstRow, "above");
          }
        }}
      >
        Insert row above
      </ContextMenuItem>
      <ContextMenuItem
        disabled={lastRow === undefined}
        onSelect={() => {
          if (lastRow !== undefined) {
            edit.onInsertRow(lastRow, "below");
          }
        }}
      >
        Insert row below
      </ContextMenuItem>
      <ContextMenuItem
        disabled={rowCount === 0}
        onSelect={() => {
          if (block) {
            edit.onDeleteRows(block.rows);
          }
        }}
        variant="destructive"
      >
        {rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={firstColumn === undefined} onSelect={onRename}>
        {firstColumn === undefined
          ? "Rename column"
          : `Rename “${columnName(firstColumn) || "column"}”`}
      </ContextMenuItem>
      <ContextMenuItem onSelect={edit.onAddColumn}>Add column</ContextMenuItem>
    </>
  );
}

function HeaderCell({
  column,
  flash,
  left,
  onResize,
  spec,
}: {
  column: Column<CellValue[]>;
  flash: boolean;
  left: number;
  onResize?: (event: unknown) => void;
  spec?: GridColumn;
}) {
  "use no memo";

  const sorted = column.getIsSorted();

  return (
    <div
      className={cn(
        "absolute top-0 flex h-full items-center border-r border-b border-border/60 bg-card",
        flash && "animate-[grid-flash_1.6s_ease-out]",
      )}
      role="columnheader"
      style={{ left, width: column.getSize() }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1 px-2 text-left font-medium hover:text-foreground"
        onClick={() => {
          column.toggleSorting();
        }}
        title={spec?.type ? `${spec.name} (${spec.type})` : spec?.name}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{spec?.name}</span>
        {sorted === "asc" && <CaretUpIcon className="size-3 shrink-0" />}
        {sorted === "desc" && <CaretDownIcon className="size-3 shrink-0" />}
      </button>
      {/* Dragging the edge resizes; the handle is the full height of the
          header so it can be grabbed without aiming. */}
      <div
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-brand-500/60"
        onDoubleClick={() => {
          column.resetSize();
        }}
        onMouseDown={onResize}
        onTouchStart={onResize}
      />
    </div>
  );
}

function inRange(
  range: null | ReturnType<typeof resolveRange>,
  position: CellPosition,
) {
  if (!range) {
    return false;
  }
  return (
    position.row >= range.firstRow &&
    position.row <= range.lastRow &&
    position.column >= range.firstColumn &&
    position.column <= range.lastColumn
  );
}

function measureColumns({
  columns,
  rows,
}: {
  columns: GridColumn[];
  rows: CellValue[][];
}) {
  const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
  return columns.map((column, index) => {
    let widest = column.name.length;
    for (const row of sample) {
      widest = Math.max(widest, row[index]?.length ?? 0);
    }
    return Math.min(
      Math.max(widest * CHARACTER_WIDTH + CELL_PADDING, MIN_COLUMN_WIDTH),
      MAX_COLUMN_WIDTH,
    );
  });
}

/**
 * The selected block as ordered, clamped bounds. Dragging up or leftwards
 * leaves the raw pair inverted, and sorting or filtering under a live selection
 * can leave it pointing past the end of what is now on screen.
 */
function resolveRange({
  columnCount,
  rowCount,
  selection,
}: {
  columnCount: number;
  rowCount: number;
  selection: null | { anchor: CellPosition; focus: CellPosition };
}) {
  if (!selection || rowCount === 0 || columnCount === 0) {
    return null;
  }
  const { anchor, focus } = selection;
  const firstRow = Math.min(anchor.row, focus.row);
  const firstColumn = Math.min(anchor.column, focus.column);
  if (firstRow >= rowCount || firstColumn >= columnCount) {
    return null;
  }
  return {
    firstColumn,
    firstRow,
    lastColumn: Math.min(
      Math.max(anchor.column, focus.column),
      columnCount - 1,
    ),
    lastRow: Math.min(Math.max(anchor.row, focus.row), rowCount - 1),
  };
}
