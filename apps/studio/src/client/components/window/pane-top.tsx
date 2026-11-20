import { createContext, type ReactNode, use } from "react";

/**
 * What a pane of one tab puts in its tab's own top row, since it draws no
 * strip: the sidebar's toggle at the row's start, for the window's first
 * pane, and its corner (+, split or ×, and the window's own end) at the
 * row's end. Absent where the pane has a strip, which holds them itself.
 */
interface PaneTop {
  corner: ReactNode;
  lead: ReactNode;
}

export const PaneTopContext = createContext<null | PaneTop>(null);

/** The pane's top row ends, where the tab's row is the pane's top (`PaneTop`). */
export function usePaneTop(): null | PaneTop {
  return use(PaneTopContext);
}

/**
 * A row that is its pane's top: the window moves by it, as by a strip,
 * and its controls still take a press.
 */
export const PANE_TOP_ROW =
  "[-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] [&_[contenteditable]]:[-webkit-app-region:no-drag] [&_[role=button]]:[-webkit-app-region:no-drag] [&_[draggable=true]]:[-webkit-app-region:no-drag]";
