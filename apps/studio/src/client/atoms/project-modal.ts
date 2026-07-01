import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";
import { atom } from "jotai";

export interface ProjectModalState {
  projectId?: ProjectId;
  taskId?: TaskId;
}

/**
 * Drives the app-wide new/edit-project modal. `null` when closed; a state
 * object (edit when `projectId` is set) when open. `<ProjectModal />` at the
 * app-chrome root reads it; `project-overlays.ts` sets it.
 */
export const projectModalAtom = atom<null | ProjectModalState>(null);
