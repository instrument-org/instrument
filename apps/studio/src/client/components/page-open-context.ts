import { createContext } from "react";

/**
 * Where a surface other than the task page sends a web page a link offers to
 * open in the app. The task page opens pages in its own browser pane; a
 * window without one says here what to do instead, and a link asks before
 * reaching for the pane.
 *
 * `newTab` is the gesture asking for a place of its own rather than for this
 * one to be given up: a middle click, a modified click, the row a menu offers
 * beside "open". A window with no second place to put a page ignores it, which
 * is the honest answer there rather than an error.
 */
export const PageOpenContext = createContext<
  ((url: string, options?: { newTab?: boolean }) => void) | null
>(null);
