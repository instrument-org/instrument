import { type ReactNode } from "react";

import { ResultRow } from "./result-row";

/** One row under the address field: what the words in it could mean. */
export interface OmniRow {
  /** Muted after the name: where the row lives (a folder's name, an address, a project). */
  detail?: string | undefined;
  /** What to draw bold in `detail` and in `name`, as pairs of offsets, or null. */
  detailRanges?: null | number[];
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
  nameRanges?: null | number[];
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
      className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-float-lg"
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
        <p className="px-2.5 py-2 text-sm text-muted-foreground">{notice}</p>
      ) : null}
      {rows.map((row, index) => (
        <ResultRow
          icon={row.icon}
          id={`${id}-${index}`}
          isLit={index === current}
          key={row.id}
          name={row.name}
          nameRanges={row.nameRanges ?? null}
          onOpen={() => {
            onRun(row);
          }}
          where={row.detail}
          whereRanges={row.detailRanges ?? null}
        />
      ))}
    </div>
  );
}
