import { createContext } from "react";

import { type OpenOptions } from "./window/context";

/**
 * Where a surface sends a file the transcript offers. A surface drawn without
 * one, such as a previewed conversation, offers nothing to open a file with.
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
  ((filePath: string, options?: OpenOptions) => void) | null
>(null);
