import { projectModalAtom } from "@/client/atoms/project-modal";
import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";

export function openCreateProject(taskId?: TaskId) {
  getDefaultStore().set(projectModalAtom, taskId ? { taskId } : {});
}

export function openEditProject(projectId: ProjectId) {
  getDefaultStore().set(projectModalAtom, { projectId });
}
