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
 * on it or its menu is open, and, for the row whose thread is open beside the
 * list, a tint the hover does not take away with a bar down its edge in the
 * brand's color.
 */
export function rowClassName(density: RowDensity, isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default gap-2 px-2 select-none hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-hidden has-[[data-state=open]]:bg-foreground/4 data-[state=open]:bg-foreground/4",
    density === "slim" ? "h-9 items-center" : "items-start py-2.5",
    isOpen &&
      "bg-brand-500/8 shadow-[inset_2px_0_0_var(--color-brand-500)] hover:bg-brand-500/10",
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
