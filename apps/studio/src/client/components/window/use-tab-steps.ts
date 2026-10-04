import { type WindowTab } from "@/client/atoms/window";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { goGuest } from "@/client/lib/browser-pool";
import {
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import {
  useCanGoBack,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { groupOfHref, isSiteGroup } from "./app-tabs";
import { type StepDirection, stepOf, stepStackOf } from "./tab-steps";
import { useWindowTabs } from "./window-tabs";

/** Back and forward for one tab, and whether each has anywhere to go. */
export interface TabSteps {
  canGoBack: boolean;
  canGoForward: boolean;
  go: (direction: StepDirection) => void;
}

/**
 * Back and forward for a group's tab up, by the one rule every way in takes
 * (`stepOf`): the row's arrows over it, the mouse's thumb buttons and the
 * history chords over its page, the page's own menu, and, for a site of the
 * window's own, the window's arrows and chords. `outer` is the window tab's
 * history a site's page runs out into.
 */
export function useTabSteps(
  up: undefined | WindowTab,
  { outer }: { outer?: { back: () => void; canGoBack: boolean } } = {},
): TabSteps {
  const { stepTab, stepVisitOf } = useWindowTabs();
  const attached = useBrowserTargets();
  const target =
    up?.kind === "page"
      ? encodeBrowserTargetId(
          up.taskId ?? WINDOW_ID,
          StoreId.SessionSchema.parse(up.id),
        )
      : undefined;
  const isAttached = target !== undefined && attached.has(target);
  const guest = useGuestNavigation(isAttached ? target : null);
  const stack = stepStackOf(up, {
    guest: isAttached ? guest : undefined,
    ...(outer ? { outer } : {}),
  });
  return {
    canGoBack: stepOf(stack, "back") !== undefined,
    canGoForward: stepOf(stack, "forward") !== undefined,
    go: (direction) => {
      const sign = direction === "back" ? -1 : 1;
      switch (stepOf(stack, direction)) {
        case "guest": {
          if (target) {
            goGuest(target, direction);
          }
          break;
        }
        case "outer": {
          outer?.back();
          break;
        }
        case "screen": {
          if (up) {
            stepTab(up.id, sign);
          }
          break;
        }
        case "visits": {
          if (up) {
            stepVisitOf(up.id, sign);
          }
          break;
        }
        case undefined: {
          break;
        }
      }
    },
  };
}

/**
 * Back and forward for the window's tab up, which its arrows and chords
 * walk: a site's page first and then the tab's history before the site, the
 * way a browser's back leaves a site at its start; anything else, the tab's
 * own router. Read under the tab up's router.
 */
export function useWindowSteps(): TabSteps {
  const router = useRouter();
  const routerCanGoBack = useCanGoBack();
  // Memory history, so its length is the real count of entries.
  const routerCanGoForward = useRouterState({
    select: (state) =>
      state.location.state.__TSR_index < router.history.length - 1,
  });
  const href = useRouterState({ select: (state) => state.location.href });
  const group = groupOfHref(href);
  const site = isSiteGroup(group) ? group : undefined;
  const { tabUpIn } = useWindowTabs();
  const page = useTabSteps(site === undefined ? undefined : tabUpIn(site), {
    outer: {
      back: () => {
        router.history.back();
      },
      canGoBack: routerCanGoBack,
    },
  });
  if (site !== undefined) {
    return page;
  }
  return {
    canGoBack: routerCanGoBack,
    canGoForward: routerCanGoForward,
    go: (direction) => {
      if (direction === "back") {
        router.history.back();
      } else {
        router.history.forward();
      }
    },
  };
}
