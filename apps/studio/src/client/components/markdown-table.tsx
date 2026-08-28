import { logger } from "@/client/lib/logger";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { BlockToolbarButton, blockToolbarButtonClassName } from "./code-block";
import { CopyButton } from "./copy-button";
import {
  tableClipboardItem,
  type TableCopyFormat,
} from "./document-viewers/table-clipboard";
import { TABLE_COPY_ALTERNATES } from "./document-viewers/table-copy-formats";
import { MarkdownTableModal } from "./markdown-table-modal";
import { readTableContents, tableRows } from "./markdown-table-rows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
 * here is whether there is still table past either end, so a fade appears on
 * the side there is more on. That has to be measured: `scroll-state(scrollable:)`
 * container queries would answer it in CSS alone, but Chromium has not shipped
 * that half of scroll-state yet, and the scroll-timeline approach
 * `scroll-fade-y` uses holds its last value when a scroller stops being
 * scrollable -- which here is every time the browser pane closes.
 *
 * Nothing in the table is pinned while the rest of it scrolls. Holding the
 * first column still reads well until the first column is wide, and then it is
 * most of the width and there is nowhere left for the columns it was supposed
 * to be identifying.
 */
export const MarkdownTable = ({
  children,
  expandable = true,
}: {
  children?: ReactNode;
  /** False inside the expanded view, which is already this table with room. */
  expandable?: boolean;
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const rowCopyRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  // The toolbar has to stay up while the menu it opened is, and neither hover
  // nor `:focus-within` still holds: the pointer is over portalled content and
  // so is the focus. The trigger's own `data-state` cannot answer it either --
  // it is wrapped in a tooltip, and the two primitives write that attribute to
  // the same element, so the tooltip's "closed" is what lands.
  const [menuOpen, setMenuOpen] = useState(false);

  const element = () => frameRef.current?.querySelector("table") ?? null;

  // An attribute rather than state: a scroll handler that re-renders every
  // table in the transcript is the one thing a transcript cannot afford, and
  // nothing about this edge is React's to know.
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

  /**
   * Moves the row control to whichever row the pointer is over.
   *
   * By hand for the same reason the scroll edge is: hovering a row would
   * otherwise re-render the whole table, and during a stream that is every row
   * of every table on screen.
   *
   * The control sits over the row's leading cell rather than beside it, and a
   * pointer already on it is left alone. Both matter: anywhere else, reaching
   * for the control leaves the row that put it there, which takes it away
   * again before the click lands.
   */
  const trackRow = (event: React.MouseEvent<HTMLDivElement>) => {
    const chip = rowCopyRef.current;
    const frame = frameRef.current;
    if (!chip || !frame || !(event.target instanceof Element)) {
      return;
    }
    if (chip.contains(event.target)) {
      return;
    }
    const row = event.target.closest("tbody tr");
    if (!(row instanceof HTMLTableRowElement)) {
      delete chip.dataset.visible;
      return;
    }
    chip.dataset.row = String(row.rowIndex);
    chip.style.top = `${row.offsetTop + (row.offsetHeight - chip.offsetHeight) / 2}px`;
    chip.style.left = `${frame.offsetLeft + 4}px`;
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
      onMouseLeave={hideRowControl}
      onMouseMove={trackRow}
    >
      <div
        className="markdown-table-frame scrollbar-thin scrollbar-color"
        ref={frameRef}
      >
        <span aria-hidden className="markdown-table-fade" data-edge="start" />
        <table>{children}</table>
        <span aria-hidden className="markdown-table-fade" data-edge="end" />

        <div className="markdown-table-toolbar" data-menu-open={menuOpen}>
          <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  copyTable("table");
                }}
              >
                Copy table
              </DropdownMenuItem>
              {TABLE_COPY_ALTERNATES.map(({ format, label }) => (
                <DropdownMenuItem
                  key={format}
                  onSelect={() => {
                    copyTable(format);
                  }}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {expandable && (
            <BlockToolbarButton
              icon={ArrowsOutSimpleIcon}
              label="Open table"
              onClick={() => {
                setExpanded(true);
              }}
            />
          )}
        </div>
      </div>

      {/* The shared control, so a row's copy reports itself with the same
          check every other copy in the app does. Positioned through the span,
          which is what the tracking moves. */}
      <span className="markdown-table-row-copy" ref={rowCopyRef}>
        <CopyButton
          className={blockToolbarButtonClassName}
          iconSize={12}
          label="Copy row"
          onCopy={() => {
            const index = Number(rowCopyRef.current?.dataset.row ?? "-1");
            const row = element()?.rows[index];
            if (row) {
              copy([
                [...row.cells].map((cell) => cell.textContent?.trim() ?? ""),
              ]);
            }
          }}
          tooltip="Copy row"
        />
      </span>

      {expandable && expanded && (
        <MarkdownTableModal onOpenChange={setExpanded} open>
          {children}
        </MarkdownTableModal>
      )}
    </div>
  );
};
