import { createContext } from "react";

/**
 * Takes the element at a `ViewerToolbar`'s end, from a file viewer that draws
 * its actions there. Its own module, so the file viewer reads it without
 * loading the toolbar the format viewers load lazily.
 */
export const ViewerToolbarEndContext = createContext<
  ((element: HTMLDivElement | null) => void) | null
>(null);
