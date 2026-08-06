import { atomWithStorage } from "jotai/utils";

/**
 * Whether the file viewer wraps a long line rather than scrolling sideways.
 *
 * A preference rather than per-file state: someone who wants to see a file's
 * real line structure wants it for the next file too, and having to set it
 * again on every open would be the annoying half of a toggle.
 */
export const fileViewerWrapLinesAtom = atomWithStorage(
  "file-viewer-wrap-lines",
  true,
);
