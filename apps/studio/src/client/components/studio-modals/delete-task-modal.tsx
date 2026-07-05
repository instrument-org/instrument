import { deleteTaskModalAtom } from "@/client/atoms/delete-task-modal";
import { TaskDeleteDialog } from "@/client/components/task/delete-dialog";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useAtom } from "jotai";

/**
 * App-wide delete-task confirmation, mounted once at the app-chrome root. Reads
 * `deleteTaskModalAtom` (opened via `openDeleteTask`). `TaskDeleteDialog` already
 * traps tab navigation while open.
 */
export function DeleteTaskModal() {
  const [state, setState] = useAtom(deleteTaskModalAtom);
  // Deferred so the dialog stays mounted (and its close animation can play)
  // for a moment after `state` clears to null, instead of unmounting the
  // instant it starts closing.
  const { content, onExitComplete } = useDeferredModalState(state);
  if (content === null) {
    return null;
  }

  return (
    <TaskDeleteDialog
      onDeleteEnd={content.onDeleteEnd}
      onDeleteStart={content.onDeleteStart}
      onExitComplete={onExitComplete}
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={state !== null}
      task={content.task}
    />
  );
}
