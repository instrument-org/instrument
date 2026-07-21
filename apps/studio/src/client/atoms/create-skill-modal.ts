import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Drives the app-wide create-skill modal. `null` when closed. Creating a skill
 * is just starting a task with the right briefing, so this carries no state of
 * its own. `<CreateSkillModal />` at the app-chrome root reads it.
 */
export const createSkillModalAtom = studioModalAtom<Record<string, never>>();

export function openCreateSkill() {
  getDefaultStore().set(createSkillModalAtom, {});
}
