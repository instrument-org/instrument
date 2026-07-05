import { studioModalAtom } from "@/client/atoms/studio-modal";
import { type Task } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

interface DeleteTaskModalState {
  onDeleteEnd?: () => void;
  onDeleteStart?: () => void;
  task: Task;
}

/**
 * Drives the app-wide delete-task confirmation. `<DeleteTaskModal />` at the
 * app-chrome root reads it; `openDeleteTask` sets it, so any trigger (sidebar,
 * task page, lists) confirms in place instead of navigating to the task page.
 */
export const deleteTaskModalAtom = studioModalAtom<DeleteTaskModalState>();

export function openDeleteTask(
  task: Task,
  options?: {
    onDeleteEnd?: () => void;
    onDeleteStart?: () => void;
  },
) {
  getDefaultStore().set(deleteTaskModalAtom, {
    onDeleteEnd: options?.onDeleteEnd,
    onDeleteStart: options?.onDeleteStart,
    task,
  });
}
