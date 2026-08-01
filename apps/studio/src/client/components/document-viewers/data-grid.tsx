import { logger } from "@/client/lib/logger";
import { cn } from "@/client/lib/utils";
import {
  CaretDownIcon,
  CaretUpIcon,
  ColumnsIcon,
  PushPinIcon,
  PushPinSlashIcon,
} from "@phosphor-icons/react";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type ColumnSizingState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { tableClipboardItem } from "./table-clipboard";
import { useCopyShortcut } from "./use-copy-shortcut";
import { ViewerToolbar, ViewerToolbarSpacer } from "./viewer-toolbar";

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

export interface GridColumn {
  /** Right, for columns whose values are numbers, so the digits line up. */
  align?: "left" | "right";
  name: string;
  /** The source's own type name, where it has one, shown beside the header. */
  type?: string;
}

interface CellPosition {
  column: number;
  row: number;
}

/**
 * The tabular body shared by every viewer whose content is rows and columns:
 * delimited text, database tables, Parquet and line-delimited JSON.
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
  note,
  rows,
  title,
}: {
  columns: GridColumn[];
  note?: string;
  rows: CellValue[][];
  title?: string;
}) {
  // `useReactTable` holds a mutable instance across renders, which the compiler
  // cannot memoize safely. See TanStack/table#6137.
  "use no memo";

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [selection, setSelection] = useState<null | {
    anchor: CellPosition;
    focus: CellPosition;
  }>(null);

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
        accessorFn: (row) => row[index] ?? null,
        filterFn: containsText,
        header: column.name,
        id: String(index),
        size: measured[index] ?? MIN_COLUMN_WIDTH,
        sortingFn: compareCells,
      })),
    [columns, measured],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columnResizeMode: "onChange",
    columns: columnDefs,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: containsText,
    onColumnFiltersChange: setColumnFilters,
    onColumnPinningChange: setColumnPinning,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    state: {
      columnFilters,
      columnPinning,
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
  const pinnedColumns = table.getLeftVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();

  const pinnedWidth = pinnedColumns.reduce(
    (total, column) => total + column.getSize(),
    0,
  );

   
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => grid,
    overscan: 12,
  });

   
  const columnVirtualizer = useVirtualizer({
    count: centerColumns.length,
    estimateSize: (index) => centerColumns[index]?.getSize() ?? MIN_COLUMN_WIDTH,
    getScrollElement: () => grid,
    horizontal: true,
    overscan: 3,
  });

  const centerWidth = columnVirtualizer.getTotalSize();

  const selectedRange = resolveRange({
    columnCount: pinnedColumns.length + centerColumns.length,
    rowCount: visibleRows.length,
    selection,
  });

  const readSelection = (withHeaders: boolean) => {
    if (!selectedRange) {
      return null;
    }
    const ordered = [...pinnedColumns, ...centerColumns];
    const block: string[][] = [];
    if (withHeaders) {
      block.push(
        ordered
          .slice(selectedRange.firstColumn, selectedRange.lastColumn + 1)
          .map((column) => columns[Number(column.id)]?.name ?? ""),
      );
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
        ordered
          .slice(selectedRange.firstColumn, selectedRange.lastColumn + 1)
          // A copied `NULL` goes out as nothing rather than the four letters,
          // which would paste as a string that happens to spell it.
          .map((column) => String(record.getValue(column.id) ?? "")),
      );
    }
    return block;
  };

  // The grid is a stack of divs rather than a real table, so the browser has no
  // selection to copy and its own menu would offer nothing. Both the shortcut
  // and the menu below are what make a selection reachable at all.
  useCopyShortcut({
    container: grid,
    onCopy: () => copyBlock(readSelection(false)),
  });

  const extendTo = (position: CellPosition, extend: boolean) => {
    setSelection((current) =>
      extend && current
        ? { anchor: current.anchor, focus: position }
        : { anchor: position, focus: position },
    );
  };

  const filtered = visibleRows.length !== rows.length;

  return (
    <>
      <ViewerToolbar>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
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
        <ColumnMenu columns={columns} table={table} />
      </ViewerToolbar>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="min-h-0 flex-1 overflow-auto outline-none"
            onPointerDown={() => {
              grid?.focus({ preventScroll: true });
            }}
            ref={setGrid}
            role="grid"
            tabIndex={-1}
          >
            <div
              className="relative text-[0.8125rem]"
              style={{
                height: rowVirtualizer.getTotalSize() + HEADER_HEIGHT,
                width: pinnedWidth + centerWidth,
              }}
            >
              <div
                className="sticky top-0 z-20 bg-card"
                role="row"
                style={{ height: HEADER_HEIGHT }}
              >
                {pinnedColumns.map((column, index) => (
                  <HeaderCell
                    column={column}
                    key={column.id}
                    left={offsetOf(pinnedColumns, index)}
                    onResize={headersById.get(column.id)?.getResizeHandler()}
                    pinned
                    spec={columns[Number(column.id)]}
                  />
                ))}
                {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
                  const column = centerColumns[virtualColumn.index];
                  return column ? (
                    <HeaderCell
                      column={column}
                      key={column.id}
                      left={pinnedWidth + virtualColumn.start}
                      onResize={headersById.get(column.id)?.getResizeHandler()}
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
                    {pinnedColumns.map((column, index) => (
                      <BodyCell
                        align={columns[Number(column.id)]?.align}
                        key={column.id}
                        left={offsetOf(pinnedColumns, index)}
                        onSelect={extendTo}
                        pinned
                        position={{ column: index, row: virtualRow.index }}
                        selected={inRange(selectedRange, {
                          column: index,
                          row: virtualRow.index,
                        })}
                        value={record.getValue(column.id)}
                        width={column.getSize()}
                      />
                    ))}
                    {columnVirtualizer
                      .getVirtualItems()
                      .map((virtualColumn) => {
                        const column = centerColumns[virtualColumn.index];
                        if (!column) {
                          return null;
                        }
                        const position = {
                          column: pinnedColumns.length + virtualColumn.index,
                          row: virtualRow.index,
                        };
                        return (
                          <BodyCell
                            align={columns[Number(column.id)]?.align}
                            key={column.id}
                            left={pinnedWidth + virtualColumn.start}
                            onSelect={extendTo}
                            position={position}
                            selected={inRange(selectedRange, position)}
                            value={record.getValue(column.id)}
                            width={column.getSize()}
                          />
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!selectedRange}
            onSelect={() => {
              copyBlock(readSelection(false));
            }}
          >
            Copy
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedRange}
            onSelect={() => {
              copyBlock(readSelection(true));
            }}
          >
            Copy with headers
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              setSelection(null);
              setGlobalFilter("");
              setColumnFilters([]);
              setSorting([]);
            }}
          >
            Reset sort and filters
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

function BodyCell({
  align,
  left,
  onSelect,
  pinned = false,
  position,
  selected,
  value,
  width,
}: {
  align?: "left" | "right";
  left: number;
  onSelect: (position: CellPosition, extend: boolean) => void;
  pinned?: boolean;
  position: CellPosition;
  selected: boolean;
  value: unknown;
  width: number;
}) {
  const text = typeof value === "string" ? value : null;

  return (
    <div
      aria-selected={selected}
      className={cn(
        "absolute top-0 h-full truncate border-r border-b border-border/40 px-2 py-1",
        align === "right" && "text-right tabular-nums",
        selected && "bg-brand-500/25",
        pinned && "z-10 bg-card",
      )}
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
      title={text ?? undefined}
    >
      {text ?? <span className="text-muted-foreground/60 italic">NULL</span>}
    </div>
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
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {table.getAllLeafColumns().map((column) => (
          <DropdownMenuItem
            key={column.id}
            onSelect={(event) => {
              // Kept open so several columns can be turned off in one visit.
              event.preventDefault();
              column.toggleVisibility();
            }}
          >
            <Checkbox checked={column.getIsVisible()} />
            <span className="truncate">
              {columns[Number(column.id)]?.name ?? column.id}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compares two cells as numbers when both read as numbers and as text
 * otherwise, so a column of counts does not sort 10 before 9. Absent values
 * sort last in either direction: they are missing data rather than the
 * smallest value.
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
  if (leftText === "") {
    return 1;
  }
  if (rightText === "") {
    return -1;
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
function copyBlock(block: null | string[][]) {
  if (!block || block.length === 0) {
    return false;
  }
  navigator.clipboard.write([tableClipboardItem(block)]).catch(
    (error: unknown) => {
      logger.error("Copying the selection failed", error);
    },
  );
  return true;
}

function HeaderCell({
  column,
  left,
  onResize,
  pinned = false,
  spec,
}: {
  column: Column<CellValue[]>;
  left: number;
  onResize?: (event: unknown) => void;
  pinned?: boolean;
  spec?: GridColumn;
}) {
  "use no memo";

  const sorted = column.getIsSorted();

  return (
    <div
      className={cn(
        "group absolute top-0 flex h-full items-center border-r border-b border-border/60 bg-card",
        pinned && "z-10",
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
      <button
        className="shrink-0 px-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground"
        onClick={() => {
          column.pin(column.getIsPinned() === "left" ? false : "left");
        }}
        title={column.getIsPinned() === "left" ? "Unpin column" : "Pin column"}
        type="button"
      >
        {column.getIsPinned() === "left" ? (
          <PushPinSlashIcon className="size-3" />
        ) : (
          <PushPinIcon className="size-3" />
        )}
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

function offsetOf(columns: Column<CellValue[]>[], index: number) {
  let offset = 0;
  for (let position = 0; position < index; position += 1) {
    offset += columns[position]?.getSize() ?? 0;
  }
  return offset;
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
    lastColumn: Math.min(Math.max(anchor.column, focus.column), columnCount - 1),
    lastRow: Math.min(Math.max(anchor.row, focus.row), rowCount - 1),
  };
}
