import { type WindowTab } from "@/client/atoms/window";

import { historyOf } from "./tab-history";

/** Which way a step goes. */
export type StepDirection = "back" | "forward";

/**
 * The histories a tab can step through, innermost first: the page's own (its
 * guest's), the screen's own router, the visits across the boundary between pages
 * and screens, and, for a site standing at the window's own level, the
 * window tab's history before the site.
 */
export const STEP_LAYERS = ["guest", "screen", "visits", "outer"] as const;

export type StepLayer = (typeof STEP_LAYERS)[number];

/** Whether each history has anywhere to go, each way. */
export type StepStack = Record<StepLayer, { back: boolean; forward: boolean }>;

const NOWHERE = { back: false, forward: false };

/**
 * The history a step walks: the innermost one with somewhere to go that way,
 * so back leaves a page's own history only at its start, a screen's history
 * only at its start, and the tab's visits only at their start. Nothing when
 * no history has anywhere to go.
 */
export function stepOf(
  stack: StepStack,
  direction: StepDirection,
): StepLayer | undefined {
  return STEP_LAYERS.find((layer) => stack[layer][direction]);
}

/**
 * What a tab can step through: its page's history as the guest reports it,
 * its screen's history, its visits, and the window tab's history behind a site.
 * A site of the window's own has nothing of its own before its page (the new
 * tab a page opens with is no stop there), so its visits never step back.
 */
export function stepStackOf(
  tab: undefined | WindowTab,
  {
    guest,
    outer,
  }: {
    /** What the page's guest reports; nothing while it has not attached. */
    guest: { canGoBack: boolean; canGoForward: boolean } | undefined;
    /** The window tab's own history, for a site standing at its level. */
    outer?: { canGoBack: boolean };
  },
): StepStack {
  if (!tab) {
    return {
      guest: NOWHERE,
      outer: { back: outer?.canGoBack ?? false, forward: false },
      screen: NOWHERE,
      visits: NOWHERE,
    };
  }
  const history = tab.kind === "screen" ? historyOf(tab) : undefined;
  return {
    guest:
      tab.kind === "page" && guest
        ? { back: guest.canGoBack, forward: guest.canGoForward }
        : NOWHERE,
    outer: { back: outer?.canGoBack ?? false, forward: false },
    screen: history
      ? {
          back: history.index > 0,
          forward: history.index < history.entries.length - 1,
        }
      : NOWHERE,
    visits: {
      back: outer === undefined && Boolean(tab.past?.length),
      forward: Boolean(tab.future?.length),
    },
  };
}
