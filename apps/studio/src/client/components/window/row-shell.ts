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
 * The tint a row of a divided list wears while the pointer is on it, its
 * menu is open, or it has the keyboard: a rounded field drawn inside the
 * row, a hair in from the hairlines above and below it, rather than the
 * row's whole box tinted edge to edge. The hairlines go on reading as one
 * list, and the row under the pointer reads as a thing in it. The row is
 * the field's box, so it has to be positioned.
 */
export const ROW_TINT =
  "before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-0.5 before:rounded-lg before:bg-foreground/4 before:opacity-0 hover:before:opacity-100 focus-visible:before:opacity-100 has-[[data-state=open]]:before:opacity-100 data-[state=open]:before:opacity-100";

/**
 * The inbox's own tint, which is the open row's bar in grey: the list's
 * full width, square, and reaching up over the hairline
 * above the row (`-top-px`). The tint is see-through, so it cannot cover a
 * hairline: the row's own goes transparent while it is tinted, and so does
 * the one on the row under it, and a row under the pointer meets the rows
 * beside it with no line and no gap. The first row has no hairline above it.
 */
const INBOX_ROW_TINT =
  "before:pointer-events-none before:absolute before:inset-x-0 before:-top-px before:bottom-0 before:bg-foreground/4 before:opacity-0 first:before:top-0 hover:before:opacity-100 focus-visible:before:opacity-100 has-[[data-state=open]]:before:opacity-100 data-[state=open]:before:opacity-100";

/**
 * The face every row of the inbox wears: a click target rather than text,
 * with no selection and no text cursor over it, the tint above while the
 * pointer is on it or its menu is open, a hairline above it that stops short
 * of the list's edges and square corners, and, for the row whose chat is
 * open beside the list, a flat bar of the brand's pale green across the
 * list's full width: no edge, no shadow, no corners, and no hairline of its
 * own or on the row under it. Its words stay where every row has them, so
 * nothing moves as a chat opens or closes.
 */
export function rowClassName(isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default items-start gap-2 border-t border-border px-3 py-2.5 select-none first:border-t-0 focus-visible:outline-hidden",
    // No hairline where the tint is, above the row or under it.
    "hover:border-transparent focus-visible:border-transparent has-[[data-state=open]]:border-transparent data-[state=open]:border-transparent",
    "[:focus-visible+&]:border-transparent [:has([data-state=open])+&]:border-transparent [:hover+&]:border-transparent [[data-open]+&]:border-transparent [[data-state=open]+&]:border-transparent",
    isOpen
      ? "border-transparent bg-brand-50 dark:bg-brand-500/15"
      : INBOX_ROW_TINT,
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
