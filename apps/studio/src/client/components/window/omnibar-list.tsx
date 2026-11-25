import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import { RowText } from "./row-text";

/** One row under the address field: what the words in it could mean. */
export interface OmniRow {
  /** Muted after the name: where the row lives (a folder's name, a site, a project), in a word or two. */
  detail?: string | undefined;
  /**
   * What the field says while the row is picked with the arrows, and what Tab
   * writes into it to go on typing from there: a page's address, a folder's
   * path ending in a separator.
   */
  fill?: string;
  icon: ReactNode;
  /** What the row stands for, unique across the list: the key React keeps its element by. */
  id: string;
  /**
   * Whether the row puts the field away itself, once it knows it has gone
   * somewhere: a path is looked for first, and the words stay when nothing is
   * there.
   */
  leavesItself?: boolean;
  name: string;
  run: () => void;
}

/**
 * The rows under the address field, the one the arrows are on lit. A press
 * on a row must not take the caret first: the box would blur, the list
 * would go, and the click would land on nothing.
 */
export function OmniList({
  current,
  id,
  notice,
  onRun,
  rows,
}: {
  current: number;
  id: string;
  /** What is said over the rows: why a path typed led nowhere. */
  notice?: ReactNode;
  onRun: (row: OmniRow) => void;
  rows: OmniRow[];
}) {
  if (rows.length === 0 && !notice) {
    return null;
  }
  return (
    <div
      className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-float-lg"
      // A press on the tab strip puts the rows away rather than moving the
      // window (`globals.css`).
      data-no-window-drag
      id={id}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      role="listbox"
    >
      {notice ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      ) : null}
      {rows.map((row, index) => (
        <button
          aria-selected={index === current}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm",
            index === current ? "bg-accent" : "hover:bg-accent/50",
          )}
          id={`${id}-${index}`}
          key={row.id}
          onClick={() => {
            onRun(row);
          }}
          // The arrows move the highlight past the list's fold; the
          // list follows, so the row picked is the row seen.
          ref={(element) => {
            if (index === current) {
              element?.scrollIntoView({ block: "nearest" });
            }
          }}
          role="option"
          tabIndex={-1}
          type="button"
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            {row.icon}
          </span>
          <RowText name={row.name} where={row.detail} />
        </button>
      ))}
    </div>
  );
}
