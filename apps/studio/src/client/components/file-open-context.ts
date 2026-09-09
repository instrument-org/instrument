import { createContext } from "react";

/**
 * Where a surface other than the task page sends a file the transcript
 * offers. The task page opens files in its pane; a window without one says
 * here what to do instead, and `useShowTaskFile` asks this before reaching for
 * a pane.
 *
 * A path ending in a slash names a folder rather than a file, and a surface
 * with somewhere to put one opens it there. One opener for both, because what
 * a transcript offers is a path, and a window that has a view of a folder has
 * it in the same tab it shows a file in.
 *
 * `newTab` is the gesture asking for a place of its own rather than for this
 * one to be given up: a middle click, a modified click, the row a menu offers
 * beside "open". A window with no second place to put a file ignores it, which
 * is the honest answer there rather than an error.
 */
export const FileOpenContext = createContext<
  ((filePath: string, options?: { newTab?: boolean }) => void) | null
>(null);
