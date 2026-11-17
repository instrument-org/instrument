import { type ReactNode, useState } from "react";

/**
 * The places in a tab's location row that whatever is up draws into: the
 * head, ahead of the arrows (the toggle for the folder beside a file, a
 * folder's sidebar toggle); beside the arrows (a page's reload); the end of the field (a
 * page's zoom, "Updated"); and the tail (a web page's controls). Then the
 * end of the view's own row under the bookmarks bar (`view`), where a file's
 * controls go. Null until the row is up.
 */
interface RowSlots {
  field: HTMLElement | null;
  lead: HTMLElement | null;
  reload: HTMLElement | null;
  tail: HTMLElement | null;
  view: HTMLElement | null;
}

/**
 * One row's slots, and the props that draw them in a `TabLocationRow`.
 * Every row draws all four, each hidden while nothing is in it, so a row
 * reads the same whatever is up and what is up decides which it fills.
 */
export function useRowSlots() {
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const [lead, setLead] = useState<HTMLDivElement | null>(null);
  const [reload, setReload] = useState<HTMLDivElement | null>(null);
  const [tail, setTail] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  return {
    rowProps: {
      // No box of its own, so a page's load line inside it is drawn against
      // the field.
      fieldEnd: <div className="contents" ref={setField} />,
      leading: (
        <div
          className="flex shrink-0 items-center empty:hidden"
          ref={setLead}
        />
      ),
      reload: (
        <div
          className="flex shrink-0 items-center empty:hidden"
          ref={setReload}
        />
      ),
      trailing: (
        <div
          className="flex shrink-0 items-center gap-1.5 empty:hidden"
          ref={setTail}
        />
      ),
    },
    slots: { field, lead, reload, tail, view } satisfies RowSlots,
    /** The `view` slot, for the end of a `ScreenToolsRow`. */
    viewEnd: (
      <div
        className="flex shrink-0 items-center gap-1.5 empty:hidden"
        ref={setView}
      />
    ),
  };
}

/**
 * The view's own row, under the bookmarks bar: the folder's controls at its
 * left (`lead`, the row's lead slot) and the file's at its right (`end`, the
 * view slot and what the tab puts ahead of it), so the folder's sit over the
 * folder and the file's over the file. Away while nothing is in either: a
 * file whose own toolbar takes its controls starts right under the bar.
 *
 * A `tabrow` container like the address row, so what is drawn into it (the
 * folder's views, a page's Edit) folds against the width this row has.
 */
export function ScreenToolsRow({
  end,
  lead,
}: {
  end?: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <div className="@container/tabrow hidden h-11 shrink-0 items-center gap-1.5 border-b border-border bg-background px-1.5 has-[>:not(:empty)]:flex">
      {lead}
      <div className="flex-1" />
      {end}
    </div>
  );
}
