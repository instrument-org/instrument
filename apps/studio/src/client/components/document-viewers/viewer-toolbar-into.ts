import { createContext } from "react";

/**
 * The row a `ViewerToolbar` draws its controls into, in place of one of its
 * own: the view's row over a file beside its folder. Null while that row has
 * no place for them, where the toolbar draws nothing; undefined where it is a
 * row of its own.
 */
export const ViewerToolbarIntoContext = createContext<
  HTMLElement | null | undefined
>(undefined);
