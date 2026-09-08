import { createContext } from "react";

/**
 * Where a surface other than the task page sends a file the transcript
 * offers. The task page opens files in its pane; a window without one says
 * here what to do instead, and `useShowTaskFile` asks this before reaching for
 * a pane.
 */
export const FileOpenContext = createContext<
  ((filePath: string) => void) | null
>(null);
