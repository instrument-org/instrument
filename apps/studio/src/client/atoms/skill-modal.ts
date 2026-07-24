import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Drives the app-wide skill modal, which both creates a new skill and edits an
 * existing one. Either is just starting a task with the right briefing, so the
 * only state the modal needs is which of the two it is (and, for an edit, the
 * skill it targets). `null` when closed. `<SkillModal />` at the app-chrome
 * root reads it.
 */
export type SkillModalState =
  | { mode: "create" }
  | { mode: "edit"; name: string; title: string };

export const skillModalAtom = studioModalAtom<SkillModalState>();

export function openCreateSkill() {
  getDefaultStore().set(skillModalAtom, { mode: "create" });
}

export function openEditSkill({
  name,
  title,
}: {
  name: string;
  title: string;
}) {
  getDefaultStore().set(skillModalAtom, { mode: "edit", name, title });
}
