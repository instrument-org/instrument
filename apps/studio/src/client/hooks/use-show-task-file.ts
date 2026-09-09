import { FileOpenContext } from "@/client/components/file-open-context";
import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { isFolderPath, type TaskId } from "@instrument-org/workspace/client";
import { useContext } from "react";
import { toast } from "sonner";

/**
 * Show one of a task's files, wherever this surface shows files.
 *
 * The task page has a pane and puts it there. A window without one says where
 * a file goes instead, so every card, chip, and expand control that hands a
 * file over asks here rather than reaching for a pane that may not be on
 * screen. Inside the app: `useOpenTaskFile` is the other thing a file can be
 * asked to do, which is to leave for the app macOS opens it with.
 *
 * A path may name a folder, and the pane has no view of one: it holds file
 * tabs, and a folder in one would be a tab reporting that it could not read
 * the file. So a folder leaves for the Finder, which is the app macOS opens a
 * folder with and the only place this window can stand the user in it. A
 * surface with a folder view of its own says so through the context.
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
    if (isFolderPath(filePath)) {
      if (taskId !== undefined) {
        void openInFinder(filePath, taskId);
      }
      return;
    }
    openFiles([filePath]);
  };
}

/**
 * Hands a folder to the Finder.
 *
 * Called rather than wired as a mutation because a fence draws without asking
 * the server anything, and a hook holding this would reach the client on every
 * render of every card in the transcript. The press is the first moment there
 * is anything to ask.
 */
async function openInFinder(folderPath: string, taskId: TaskId) {
  const [error] = await safe(
    rpcClient.utils.openTaskFile.call({
      // Without the trailing slash: what the main process resolves is a path,
      // and a folder is not a different one for wearing it.
      filePath: folderPath.slice(0, -1),
      id: taskId,
    }),
  );
  if (error) {
    toast.error("Failed to open folder", { description: error.message });
  }
}
