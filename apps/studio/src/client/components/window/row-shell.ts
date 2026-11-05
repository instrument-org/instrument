import { cn } from "@/client/lib/utils";
import { type ReactNode, type SyntheticEvent } from "react";

/** One thing a row offers from its edge and its menu alike: what it is called, its mark, and what it does. */
export interface RowAction {
  /** Offered only in developer mode, and drawn in its color so it reads as such. */
  developerMode?: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  /** Offered in the row's menu alone, not on the tile the pointer raises: for an action the row already carries a control for. */
  menuOnly?: boolean;
  run: () => void;
}

/**
 * The inbox's own tint, which is the open row's bar at half strength, so a
 * row under the pointer reads as halfway to open: the list's full width and
 * square, between the row's hairlines, which stay put while the row is
 * tinted.
 */
const INBOX_ROW_TINT =
  // Under the row's words (`-z-10` in the row's own stacking context), so a
  // light fill never washes them out.
  "isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-card/50 before:opacity-0 hover:before:opacity-100 focus-visible:before:opacity-100 has-[[data-state=open]]:before:opacity-100 data-[state=open]:before:opacity-100";

/**
 * The face every row of the inbox wears: a click target rather than text,
 * with no selection and no text cursor over it, the tint above while the
 * pointer is on it or its menu is open, a hairline above it, the first row's
 * included, and one under the last, and square corners, and, for the row whose chat is
 * open beside the list, a flat bar of the card's own color across the
 * list's full width, white on the list's grey in light mode. Every row keeps
 * its hairlines whatever the pointer does, and its words stay where every
 * row has them, so nothing moves as a chat opens or closes.
 */
export function rowClassName(isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default items-start gap-2 border-t border-border/70 px-4 py-2.5 select-none last:border-b focus-visible:outline-hidden",
    // The hairline is see-through, so the open row's lighter fill would
    // show through its own and brighten it: the fill stops short of it.
    "bg-clip-padding",
    // See-through inside a project's list, so the project's wash shows in it.
    isOpen ? "bg-card in-data-project:bg-card/65" : INBOX_ROW_TINT,
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
