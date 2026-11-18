import { createContext, use } from "react";

import { type Stage, stage } from "./stage";

/**
 * The stage a transcript's reveals run on: the window's own, unless a page
 * that drives its own clock (the debug replay) puts one of its own around its
 * transcript, so pausing it never pauses a chat in another tab.
 */
export const StageContext = createContext<Stage>(stage);

export function useStage(): Stage {
  return use(StageContext);
}
