import { FileOpenContext } from "@/client/components/file-open-context";
import { type OpenOptions } from "@/client/components/window/context";
import { useContext } from "react";

/**
 * Show one of a task's files, wherever this surface shows files.
 *
 * Every card, chip, and expand control that hands a file over asks here, and
 * the surface it is drawn on says where the file goes, a folder included.
 * Inside the app: `useOpenTaskFile` is the other thing a file can be asked to
 * do, which is to leave for the app macOS opens it with.
 *
 * A surface drawn without an opener, such as a previewed conversation or a
 * debug scenario, still draws the reference, and opening it does nothing.
 */
export function useShowTaskFile() {
  const openFile = useContext(FileOpenContext);

  return (filePath: string, options?: OpenOptions) => {
    openFile?.(filePath, options);
  };
}
