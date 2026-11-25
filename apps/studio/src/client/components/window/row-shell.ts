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
 * The face every row of the inbox wears: a click target rather than text,
 * with no selection and no text cursor over it, on a rounded fill while the
 * pointer is on it, its menu is open or its chat is open. Its words stay where
 * every row has them, so nothing moves as a chat opens or closes.
 */
export function rowClassName(isOpen: boolean) {
  return cn(
    "group/row relative flex cursor-default items-start gap-2 rounded-lg px-3 py-2.5 select-none focus-visible:outline-hidden",
    isOpen
      ? "bg-foreground/7"
      : "hover:bg-foreground/4 focus-visible:bg-foreground/4 has-[[data-state=open]]:bg-foreground/4 data-[state=open]:bg-foreground/4",
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open what the row stands for. */
export function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}
