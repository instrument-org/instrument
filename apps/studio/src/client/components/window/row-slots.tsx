import { useState } from "react";

/**
 * The places in a tab's location row that whatever is up draws into: the
 * head, ahead of the arrows (a file's tree toggle, a folder's sidebar
 * toggle); beside the arrows (a page's reload); the end of the field (a
 * page's zoom, "Updated"); and the tail (a page's controls, a file's
 * actions). Null until the row is up.
 */
interface RowSlots {
  field: HTMLElement | null;
  lead: HTMLElement | null;
  reload: HTMLElement | null;
  tail: HTMLElement | null;
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
          className="flex shrink-0 items-center gap-0.5 empty:hidden"
          ref={setTail}
        />
      ),
    },
    slots: { field, lead, reload, tail } satisfies RowSlots,
  };
}
