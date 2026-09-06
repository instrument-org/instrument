import { createContext } from "react";

/**
 * Where a surface other than the task page sends a web page a link offers to
 * open in the app. The task page opens pages in its own browser pane; a
 * window without one says here what to do instead, and a link asks before
 * reaching for the pane.
 */
export const PageOpenContext = createContext<((url: string) => void) | null>(
  null,
);
