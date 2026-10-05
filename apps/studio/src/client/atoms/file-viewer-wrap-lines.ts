import { keptAtom } from "@/client/lib/kept-state";

/**
 * Whether the file viewer wraps a long line rather than scrolling sideways.
 *
 * A preference rather than per-file state: someone who wants to see a file's
 * real line structure wants it for the next file too, and having to set it
 * again on every open would be the annoying half of a toggle.
 */
export const fileViewerWrapLinesAtom = keptAtom(
  "view",
  "file-viewer-wrap-lines.v1",
  true,
);
