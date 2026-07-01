import { deleteTaskModalAtom } from "@/client/atoms/delete-task-modal";
import { TaskDeleteDialog } from "@/client/components/task/delete-dialog";
import { useAtom } from "jotai";

/**
 * App-wide delete-task confirmation, mounted once at the app-chrome root. Reads
 * `deleteTaskModalAtom` (opened via `openDeleteTask`). `TaskDeleteDialog` already
 * traps tab navigation while open.
 */
export function DeleteTaskModal() {
  const [state, setState] = useAtom(deleteTaskModalAtom);
  if (state === null) {
    return null;
  }

  return (
    <TaskDeleteDialog
      navigateOnDelete={state.navigateOnDelete}
      onDeleteEnd={state.onDeleteEnd}
      onDeleteStart={state.onDeleteStart}
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open
      task={state.task}
    />
  );
}
