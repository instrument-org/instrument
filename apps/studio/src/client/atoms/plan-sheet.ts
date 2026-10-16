import { keptAtom } from "@/client/lib/kept-state";
import { atom, getDefaultStore } from "jotai";

interface PlanSheetState {
  /** The plan whose card leads, when the sheet opens for one (Upgrade). */
  preselect?: string;
}

/**
 * The plan sheet (`null` when closed). Outside the one app-wide modal slot on
 * purpose: it opens over Settings as well as over a chat, and closing it puts
 * the reader back in whichever they came from, so it stacks rather than
 * replacing the modal under it.
 */
export const planSheetAtom = atom<null | PlanSheetState>(null);

/**
 * The plan picked when the trial started, which the sheet the trial's end
 * opens leads with.
 */
export const trialPlanAtom = keptAtom<null | string>(
  "layout",
  "billing-trial-plan.v1",
  null,
);

export function openPlanSheet(state: PlanSheetState = {}) {
  getDefaultStore().set(planSheetAtom, state);
}
