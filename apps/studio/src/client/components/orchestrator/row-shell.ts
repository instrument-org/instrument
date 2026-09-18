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
 * The face every row of the inbox wears: a click target rather than text,
 * with no selection and no text cursor over it, a tint while the pointer is
 * on it or its menu is open, a hairline above it that stops short of the
 * list's edges, and, for the row whose thread is open beside the list, the
 * shape of a card lifted off the list: the card's ground, rounded corners,
 * an edge, and no hairline of its own or on the row under it.
 */
export function rowClassName(density: RowDensity, isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default gap-2 rounded-xl border-t border-border px-2 select-none first:border-t-0 hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-hidden has-[[data-state=open]]:bg-foreground/4 data-[state=open]:bg-foreground/4 [[data-open]+&]:border-transparent",
    density === "slim" ? "h-9 items-center" : "items-start py-2.5",
    isOpen &&
      "my-1 border-transparent bg-card shadow-sm ring-1 ring-border hover:bg-card",
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
