import { type WindowTab } from "@/client/atoms/window";
import { atom } from "jotai";

import { matchScreen } from "./window-href";

/**
 * The screens a window keeps drawn while another tab, or another tab group,
 * is up: out of sight, where they stood, as a browser keeps the tabs behind
 * the one in front. A file come back to is as it was left, scrolled and
 * edited where it was, a film still at its place and still playing.
 *
 * A screen is kept on the side of the group it was up on, so its group's
 * sides stay drawn with it, invisible. A page needs none of this: its guest
 * is the browser pool's, which keeps it by its own clocks.
 */

/** How many screens stay drawn behind the ones up, the longest out of sight let go first. */
export const KEPT_SCREENS = 10;

/** The tabs whose screens are drawn, the one last brought up first: those up, then those kept behind them. */
export const keptScreensAtom = atom<readonly string[]>([]);

/** The screens that open at their end or start empty each time, which are drawn afresh as they come up. */
const DRAWN_AFRESH = new Set(["chat", "chatLink", "chatOfSession", "inbox"]);

/** Whether a tab's screen is one to keep drawn: any but a page, a chat, or a new chat. */
export function isKeptScreen(tab: WindowTab) {
  return tab.kind === "screen" && !DRAWN_AFRESH.has(matchScreen(tab.href).kind);
}

/** The kept screens with one brought up, and the longest out of sight let go past the cap. */
export function withScreenUp(
  kept: readonly string[],
  id: string,
): readonly string[] {
  if (kept[0] === id) {
    return kept;
  }
  return [id, ...kept.filter((each) => each !== id)].slice(0, KEPT_SCREENS + 1);
}

/** The kept screens without those whose tabs have closed. */
export function withoutClosed(
  kept: readonly string[],
  open: ReadonlySet<string>,
): readonly string[] {
  const still = kept.filter((id) => open.has(id));
  return still.length === kept.length ? kept : still;
}
