import { logger } from "@/client/lib/logger";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { BlockToolbarButton, blockToolbarButtonClassName } from "./code-block";
import { type CellValue, type GridColumn } from "./document-viewers/data-grid";
import {
  tableClipboardItem,
  type TableCopyFormat,
} from "./document-viewers/table-clipboard";
import { TABLE_COPY_FORMATS } from "./document-viewers/table-copy-formats";
import { TableCopyFormatLabel } from "./document-viewers/table-copy-menu";
import { MarkdownTableModal } from "./markdown-table-modal";
import { readTableContents, tableGrid, tableRows } from "./markdown-table-rows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const copy = (rows: string[][], format?: TableCopyFormat) => {
  if (rows.length === 0) {
    return;
  }
  navigator.clipboard
    .write([tableClipboardItem(rows, format)])
    .catch((error: unknown) => {
      logger.error("Copying the table failed", error);
    });
};

/**
 * A Markdown table, in a block that takes the room the transcript has before it
 * resorts to scrolling, and carries the controls a table wants once it is one
 * thing rather than a run of prose: copy, copy one row, and open.
 *
 * The geometry is all in `markdown-table-row` / `markdown-table-frame`; what is
 * here is which edges still have table behind them, so the fade and the pinned
 * first column appear when they mean something. That has to be measured:
 * `scroll-state(scrollable:)` container queries would answer it in CSS alone,
 * but Chromium has not shipped that half of scroll-state yet, and the
 * scroll-timeline approach `scroll-fade-y` uses holds its last value when a
 * scroller stops being scrollable -- which here is every time the browser pane
 * closes.
 */
export const MarkdownTable = ({ children }: { children?: ReactNode }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const rowCopyRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<null | {
    columns: GridColumn[];
    rows: CellValue[][];
  }>(null);

  const element = () => frameRef.current?.querySelector("table") ?? null;

  // Attributes rather than state: a scroll handler that re-renders every table
  // in the transcript is the one thing a transcript cannot afford, and nothing
  // about these two edges is React's to know.
  const sync = () => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const behind = frame.scrollWidth - frame.clientWidth - frame.scrollLeft;
    frame.toggleAttribute("data-scroll-start", frame.scrollLeft > 1);
    frame.toggleAttribute("data-scroll-end", behind > 1);
  };

  // After every render, which is what catches the table growing a column at a
  // time while it streams: the frame is already at its cap by then, so its own
  // size never changes and no observer fires.
  useEffect(sync);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    frame.addEventListener("scroll", sync, { passive: true });
    // The frame's width moves when the pane does, which raises no scroll event
    // and no render.
    const observer = new ResizeObserver(sync);
    observer.observe(frame);

    return () => {
      frame.removeEventListener("scroll", sync);
      observer.disconnect();
    };
    // `sync` reads the ref and closes over nothing, so the empty deps are what
    // keep the listener from being torn down and re-added every chunk.
  }, []);

  const copyTable = (format: TableCopyFormat) => {
    const table = element();
    if (table) {
      copy(tableRows(readTableContents(table)), format);
    }
  };

  // The row control is moved and revealed by hand for the same reason the
  // edges are: hovering a row would otherwise re-render the whole table, and
  // during a stream that is every row of every table on screen.
  const trackRow = (event: React.PointerEvent<HTMLDivElement>) => {
    const chip = rowCopyRef.current;
    const frame = frameRef.current;
    if (!chip || !frame) {
      return;
    }
    const row = (event.target as HTMLElement).closest("tbody tr");
    if (!(row instanceof HTMLTableRowElement)) {
      delete chip.dataset.visible;
      return;
    }
    chip.dataset.row = String(row.rowIndex);
    chip.style.top = `${row.offsetTop + (row.offsetHeight - chip.offsetHeight) / 2}px`;
    chip.style.left = `${frame.offsetLeft}px`;
    chip.dataset.visible = "";
  };

  const hideRowControl = () => {
    const chip = rowCopyRef.current;
    if (chip) {
      delete chip.dataset.visible;
    }
  };

  return (
    <div
      className="markdown-table-row"
      onPointerLeave={hideRowControl}
      onPointerMove={trackRow}
    >
      <div
        className="markdown-table-frame scrollbar-thin scrollbar-color"
        ref={frameRef}
      >
        <table>{children}</table>
        <span aria-hidden className="markdown-table-fade" />

        <div className="markdown-table-toolbar">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger
                  aria-label="Copy table"
                  className={blockToolbarButtonClassName}
                >
                  <CopyIcon size={12} />
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Copy table</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="max-w-72">
              <DropdownMenuLabel>Copy table</DropdownMenuLabel>
              {TABLE_COPY_FORMATS.map(({ format, hint, label }) => (
                <DropdownMenuItem
                  key={format}
                  onSelect={() => {
                    copyTable(format);
                  }}
                >
                  <TableCopyFormatLabel hint={hint} label={label} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <BlockToolbarButton
            icon={ArrowsOutSimpleIcon}
            label="Open table"
            onClick={() => {
              const table = element();
              if (table) {
                setExpanded(tableGrid(table));
              }
            }}
          />
        </div>
      </div>

      <button
        aria-label="Copy row"
        className="markdown-table-row-copy"
        onClick={(event) => {
          const table = element();
          const index = Number(event.currentTarget.dataset.row ?? "-1");
          const row = table?.rows[index];
          if (row) {
            copy([
              [...row.cells].map((cell) => cell.textContent?.trim() ?? ""),
            ]);
          }
        }}
        ref={rowCopyRef}
        type="button"
      >
        <CopyIcon size={12} />
      </button>

      {expanded && (
        <MarkdownTableModal
          columns={expanded.columns}
          onOpenChange={(open) => {
            if (!open) {
              setExpanded(null);
            }
          }}
          open
          rows={expanded.rows}
        />
      )}
    </div>
  );
};
