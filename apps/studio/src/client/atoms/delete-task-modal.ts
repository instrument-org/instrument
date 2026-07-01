import { type Task } from "@instrument-org/workspace/client";
import { atom, getDefaultStore } from "jotai";

interface DeleteTaskModalState {
  // Navigate the active tab to /new-tab after delete (used from the task's own
  // page); otherwise `useTrashTask` just closes any tabs showing the task.
  navigateOnDelete: boolean;
  onDeleteEnd?: () => void;
  onDeleteStart?: () => void;
  task: Task;
}

/**
 * Drives the app-wide delete-task confirmation. `<DeleteTaskModal />` at the
 * app-chrome root reads it; `openDeleteTask` sets it, so any trigger (sidebar,
 * task page, lists) confirms in place instead of navigating to the task page.
 */
export const deleteTaskModalAtom = atom<DeleteTaskModalState | null>(null);

export function openDeleteTask(
  task: Task,
  options?: {
    navigateOnDelete?: boolean;
    onDeleteEnd?: () => void;
    onDeleteStart?: () => void;
  },
) {
  getDefaultStore().set(deleteTaskModalAtom, {
    navigateOnDelete: options?.navigateOnDelete ?? false,
    onDeleteEnd: options?.onDeleteEnd,
    onDeleteStart: options?.onDeleteStart,
    task,
  });
}
