import { createContext } from "react";

/**
 * Where a surface other than the task page sends a file the transcript
 * offers. The task page opens files in its pane; a window without one says
 * here what to do instead, and the grids that draw file cards ask before
 * reaching for the pane.
 */
export const FileOpenContext = createContext<
  ((filePath: string) => void) | null
>(null);
