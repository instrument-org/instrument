import { createContext } from "react";

import { type OpenOptions } from "./window/context";

/**
 * Where a surface sends a web page a link offers to open in the app. Drawn
 * without one, a link offers only the places outside the app.
 *
 * `newTab` is the gesture asking for a place of its own rather than for this
 * one to be given up: a middle click, a modified click, the row a menu offers
 * beside "open". A window with no second place to put a page ignores it, which
 * is the honest answer there rather than an error.
 */
export const PageOpenContext = createContext<
  ((url: string, options?: OpenOptions) => void) | null
>(null);
