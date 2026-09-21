import { cn } from "@/client/lib/utils";
import { type ReactNode, type SyntheticEvent } from "react";

/** One thing a row offers from its edge and its menu alike: what it is called, its mark, and what it does. */
export interface RowAction {
  icon: ReactNode;
  id: string;
  label: string;
  /** Offered in the row's menu alone, not on the tile the pointer raises: for an action the row already carries a control for. */
  menuOnly?: boolean;
  run: () => void;
}

/** The two shapes a row takes, by the room the list has: one line across a wide list, three down a narrow one. */
export type RowDensity = "slim" | "tall";

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
 * The face every row of the inbox wears: a click target rather than text,
 * with no selection and no text cursor over it, the tint above while the
 * pointer is on it or its menu is open, a hairline above it that stops short
 * of the list's edges and square corners, and, for the row whose thread is
 * open beside the list, the shape of a card lifted off the list: the card's
 * ground, rounded corners, an edge, no tint, and no hairline of its own or
 * on the row under it. The card takes the air around it out of its own
 * height rather than adding it, so its footprint in the list is a resting
 * row's and nothing under it moves as a thread opens or closes: its words
 * stay where the row had them, with a hair less of the card's ground above
 * and below them.
 */
export function rowClassName(density: RowDensity, isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default gap-2 border-t border-border px-2 select-none first:border-t-0 focus-visible:outline-hidden [[data-open]+&]:border-transparent",
    density === "slim"
      ? cn("items-center", isOpen ? "my-0.5 h-8" : "h-9")
      : cn("items-start", isOpen ? "my-0.5 py-2" : "py-2.5"),
    isOpen
      ? "rounded-xl border-transparent bg-card shadow-sm ring-1 ring-border"
      : ROW_TINT,
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
