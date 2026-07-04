import { studioModalAtom } from "@/client/atoms/studio-modal";
import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

interface ProjectModalState {
  projectId?: ProjectId;
  taskId?: TaskId;
}

/**
 * Drives the app-wide new/edit-project modal. `null` when closed; a state
 * object (edit when `projectId` is set) when open. `<ProjectModal />` at the
 * app-chrome root reads it; the openers below set it.
 */
export const projectModalAtom = studioModalAtom<ProjectModalState>();

export function openCreateProject(taskId?: TaskId) {
  getDefaultStore().set(projectModalAtom, taskId ? { taskId } : {});
}

export function openEditProject(projectId: ProjectId) {
  getDefaultStore().set(projectModalAtom, { projectId });
}
