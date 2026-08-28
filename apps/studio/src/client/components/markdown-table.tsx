import { logger } from "@/client/lib/logger";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { type ReactNode, useEffect, useRef, useState } from "react";

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

/** The middle of a row, which is the furthest a control gets from both rules. */
const bandCenter = (row: Element | null) =>
  row instanceof HTMLTableRowElement
    ? row.offsetTop + row.offsetHeight / 2
    : undefined;

// How long the row control reports a copy for.
const COPIED_MS = 2000;

// Between a control and the table's edge, whichever side of it the control is.
const CONTROL_GAP = 8;

/** The transcript the block sits in, where one named itself. */
const transcriptOf = (frame: HTMLElement) => frame.closest("[data-transcript]");

/**
 * How much transcript there is beside the block, on one side.
 *
 * The block is centered on the text measure and the measure is centered in the
 * transcript, so the two cancel and this is only ever half of what the block
 * has not taken. Zero without a transcript to measure, which leaves every
 * control on top of the table, as they were.
 *
 * Measured off the element rather than read from `--transcript-room`: that
 * value reaches this through a container query, and a resize can arrive here
 * before the query has been recomputed -- which reads as no room at all, and
 * sends every control back on top of the table for the rest of the session.
 */
const roomBesideBlock = (frame: HTMLElement) => {
  const room = transcriptOf(frame)?.clientWidth ?? 0;
  return room > 0 ? (room - frame.offsetWidth) / 2 : 0;
};

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
 * The controls stand beside the table wherever the transcript is wide enough
 * to hold them there, and fall back onto its trailing edge where it is not.
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The row control is one element moved between rows, so its "copied" state
  // has to be cleared when it lands on a different one -- a check left over
  // from the row above reads as a copy that never happened.
  const copiedTimer = useRef<number>(undefined);
  // Frozen while its menu is open, or the pointer moving to that menu would
  // take the control out from under it. Controlled rather than left to Radix,
  // which is also what lets the freeze read it.
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The toolbar has to stay up while the menu it opened is, and neither hover
  // nor `:focus-within` still holds: the pointer is over portalled content and
  // so is the focus. The trigger's own `data-state` cannot answer it either --
  // it is wrapped in a tooltip, and the two primitives write that attribute to
  // the same element, so the tooltip's "closed" is what lands.
  const [menuOpen, setMenuOpen] = useState(false);

  const element = () => frameRef.current?.querySelector("table") ?? null;

  /**
   * Puts a control beside the table where the transcript has room for it, and
   * back on top of it where it does not.
   *
   * Both controls answer to the toolbar's width rather than their own, so a
   * pane wide enough for one and not the other never splits them across the
   * table's edge.
   */
  const placeControl = (control: HTMLElement, frame: HTMLElement) => {
    const width = toolbarRef.current?.offsetWidth ?? 0;
    const outside = width > 0 && roomBesideBlock(frame) >= width + CONTROL_GAP;
    const edge = frame.offsetLeft + frame.clientWidth;
    control.toggleAttribute("data-outside", outside);
    control.style.left = `${outside ? edge + CONTROL_GAP : edge - 4}px`;
  };

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

    // Centered in the header's own band, at the trailing end of what is
    // visible: a control between two rows would sit on the rule that divides
    // them, and centering is what puts the most air between it and both.
    // `clientWidth` rather than the frame's box, so a scrollbar does not push
    // it under one; the controls are translated back by their own size, so
    // neither has to be measured.
    const toolbar = toolbarRef.current;
    const header = frame.querySelector("thead tr");
    if (toolbar) {
      toolbar.style.top = `${bandCenter(header) ?? frame.offsetTop + 12}px`;
      placeControl(toolbar, frame);
    }
  };

  // `sync` measures, so it is a different function every render. The listeners
  // are given a ref to whichever is current rather than the one that existed
  // when they were attached, which is what lets them be attached once.
  const syncRef = useRef(sync);

  // After every render, which is what catches the table growing a column at a
  // time while it streams: the frame is already at its cap by then, so its own
  // size never changes and no observer fires.
  useEffect(() => {
    syncRef.current = sync;
    sync();
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const run = () => {
      syncRef.current();
    };

    frame.addEventListener("scroll", run, { passive: true });

    // Neither the frame's width nor the transcript's raises a scroll event or a
    // render, and the controls are placed from both.
    const observer = new ResizeObserver(run);
    observer.observe(frame);
    const transcript = transcriptOf(frame);
    if (transcript) {
      observer.observe(transcript);
    }

    return () => {
      frame.removeEventListener("scroll", run);
      observer.disconnect();
      window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyTable = (format: TableCopyFormat) => {
    const table = element();
    if (table) {
      copy(tableRows(readTableContents(table)), format);
    }
  };

  const clearCopied = (chip: HTMLElement) => {
    window.clearTimeout(copiedTimer.current);
    delete chip.dataset.copied;
  };
  /**
   * Moves the row control to whichever row the pointer is over.
   *
   * By hand for the same reason the scroll edge is: hovering a row would
   * otherwise re-render the whole table, and during a stream that is every row
   * of every table on screen.
   *
   * A pointer already on the control is left alone, which together with it
   * riding the row's own edge is what makes it reachable: anywhere else,
   * reaching for it leaves the row that put it there, and the row takes it
   * away again before the click lands.
   */
  const trackRow = (event: React.MouseEvent<HTMLDivElement>) => {
    const chip = rowCopyRef.current;
    const frame = frameRef.current;
    if (!chip || !frame || !(event.target instanceof Element)) {
      return;
    }
    if (rowMenuOpen || chip.contains(event.target)) {
      return;
    }
    const row = event.target.closest("tbody tr");
    if (!(row instanceof HTMLTableRowElement)) {
      delete chip.dataset.visible;
      return;
    }
    if (chip.dataset.row !== String(row.rowIndex)) {
      clearCopied(chip);
    }
    chip.dataset.row = String(row.rowIndex);
    chip.style.top = `${bandCenter(row) ?? 0}px`;
    placeControl(chip, frame);
    chip.dataset.visible = "";
  };

  const hideRowControl = () => {
    const chip = rowCopyRef.current;
    if (chip && !rowMenuOpen) {
      delete chip.dataset.visible;
    }
  };

  const copyRow = (format: TableCopyFormat) => {
    const chip = rowCopyRef.current;
    const table = element();
    const row = table?.rows[Number(chip?.dataset.row ?? "-1")];
    if (!chip || !table || !row) {
      return;
    }
    const values = [...row.cells].map((cell) => cell.textContent.trim());
    // Markdown and CSV both carry their column names as part of the format --
    // a pipe table without a header row is not a table at all, and would come
    // out with this row's values standing in as the headings. A plain copy is
    // the row itself, since it is going next to rows that already have them.
    const { head } = readTableContents(table);
    copy(
      format === "table" || head.length === 0 ? [values] : [head, values],
      format,
    );
    clearCopied(chip);
    chip.dataset.copied = "";
    copiedTimer.current = window.setTimeout(() => {
      delete chip.dataset.copied;
    }, COPIED_MS);
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
      </div>

      <div
        className="markdown-table-toolbar"
        data-menu-open={menuOpen}
        ref={toolbarRef}
      >
        <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Copy table"
                className="markdown-table-control"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Expand table"
                className="markdown-table-control"
                onClick={() => {
                  setExpanded(true);
                }}
                type="button"
              >
                <ArrowsOutSimpleIcon size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Expand table</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* The same three formats the whole table offers, since a row is worth
          taking away in the same shapes. Both icons are drawn and CSS picks
          one, so reporting a copy costs no render. */}
      <span className="markdown-table-row-copy" ref={rowCopyRef}>
        <DropdownMenu onOpenChange={setRowMenuOpen} open={rowMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Copy row"
                className="markdown-table-control"
              >
                <CopyIcon className="markdown-table-idle" size={12} />
                <CheckIcon className="markdown-table-copied" size={12} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Copy row</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                copyRow("table");
              }}
            >
              Copy row
            </DropdownMenuItem>
            {TABLE_COPY_ALTERNATES.map(({ format, label }) => (
              <DropdownMenuItem
                key={format}
                onSelect={() => {
                  copyRow(format);
                }}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>

      {expandable && expanded && (
        <MarkdownTableModal onOpenChange={setExpanded} open>
          {/* The same block again, only wider, and without an expand of its
              own. Built here rather than inside the modal, which would close a
              cycle between the two files. */}
          <MarkdownTable expandable={false}>{children}</MarkdownTable>
        </MarkdownTableModal>
      )}
    </div>
  );
};
