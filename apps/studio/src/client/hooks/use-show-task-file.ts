import { FileOpenContext } from "@/client/components/file-open-context";
import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { type TaskId } from "@instrument-org/workspace/client";
import { useContext } from "react";

/**
 * Show one of a task's files, wherever this surface shows files.
 *
 * The task page has a pane and puts it there. A window without one says where
 * a file goes instead, so every card, chip, and expand control that hands a
 * file over asks here rather than reaching for a pane that may not be on
 * screen. Inside the app: `useOpenTaskFile` is the other thing a file can be
 * asked to do, which is to leave for the app macOS opens it with.
 *
 * `taskId` is optional for the same reason those surfaces render outside a
 * task route at all -- a previewed conversation, the debug scenarios -- where
 * a file reference is still worth drawing and opening it has nowhere to go.
 */
export function useShowTaskFile(taskId: TaskId | undefined) {
  const openElsewhere = useContext(FileOpenContext);
  const { openFiles } = useTaskPaneActions(taskId);

  return (filePath: string) => {
    if (openElsewhere) {
      openElsewhere(filePath);
      return;
    }
    openFiles([filePath]);
  };
}
