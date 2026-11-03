import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * The project whose details are open, by id (`null` when closed).
 * `<ProjectDetailsModal />` at the window root reads it; the project's banner,
 * the inbox's head and a chat's note about a project it changed open it.
 */
export const projectDetailsModalAtom = studioModalAtom<{ projectId: string }>();

export function openProjectDetails(projectId: string) {
  getDefaultStore().set(projectDetailsModalAtom, { projectId });
}
