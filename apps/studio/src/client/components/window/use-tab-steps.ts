import { type WindowTab } from "@/client/atoms/window";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useGuestNavigation } from "@/client/hooks/use-guest-navigation";
import { goGuest } from "@/client/lib/browser-pool";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import {
  useCanGoBack,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtomValue } from "jotai";

import { appTabsAtom, groupOfHref, isSiteGroup } from "./app-tabs";
import { hostGroupOf } from "./hosted-page";
import {
  NOWHERE,
  type StepDirection,
  stepOf,
  type StepStack,
  stepStackOf,
} from "./tab-steps";
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
  const { allTabs, stepTab, stepVisitOf } = useWindowTabs();
  const { guest, target } = usePageGuest(
    up?.kind === "page" ? up : up && hostedPageOf(allTabs, up.id),
  );
  const stack = stepStackOf(up, {
    guest,
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
 * own router, after the history of a page its file screen draws beside the
 * tree. Read under the tab up's router.
 */
export function useWindowSteps(): TabSteps {
  const router = useRouter();
  const { allTabs, selectedTabIn } = useWindowTabs();
  // The page a file screen in the tab draws beside its tree.
  const { selectedId } = useAtomValue(appTabsAtom);
  const hosted = usePageGuest(
    selectedId === null ? undefined : hostedPageOf(allTabs, selectedId),
  );
  const routerCanGoBack = useCanGoBack();
  // Memory history, so its length is the real count of entries.
  const routerCanGoForward = useRouterState({
    select: (state) =>
      state.location.state.__TSR_index < router.history.length - 1,
  });
  const href = useRouterState({ select: (state) => state.location.href });
  const group = groupOfHref(href);
  const site = isSiteGroup(group) ? group : undefined;
  const page = useTabSteps(
    site === undefined ? undefined : selectedTabIn(site),
    {
      outer: {
        back: () => {
          router.history.back();
        },
        canGoBack: routerCanGoBack,
      },
    },
  );
  if (site !== undefined) {
    return page;
  }
  const stack: StepStack = {
    guest: hosted.guest
      ? { back: hosted.guest.canGoBack, forward: hosted.guest.canGoForward }
      : NOWHERE,
    outer: NOWHERE,
    screen: { back: routerCanGoBack, forward: routerCanGoForward },
    visits: NOWHERE,
  };
  return {
    canGoBack: stepOf(stack, "back") !== undefined,
    canGoForward: stepOf(stack, "forward") !== undefined,
    go: (direction) => {
      const layer = stepOf(stack, direction);
      if (layer === "guest" && hosted.target) {
        goGuest(hosted.target, direction);
      } else if (layer === "screen") {
        if (direction === "back") {
          router.history.back();
        } else {
          router.history.forward();
        }
      }
    },
  };
}

/** The page a file screen in the tab with that id draws beside its tree, if any. */
function hostedPageOf(
  tabs: readonly WindowTab[],
  tabId: string,
): undefined | WindowTab {
  const group = hostGroupOf(tabId);
  return tabs.find((tab) => tab.group === group && tab.kind === "page");
}

/** A page's guest, once attached, and its history as the guest reports it. */
function usePageGuest(page: undefined | WindowTab): {
  guest: { canGoBack: boolean; canGoForward: boolean } | undefined;
  target: BrowserTargetId | undefined;
} {
  const attached = useBrowserTargets();
  const target =
    page?.kind === "page"
      ? encodeBrowserTargetId(
          page.taskId ?? WINDOW_ID,
          StoreId.SessionSchema.parse(page.id),
        )
      : undefined;
  const isAttached = target !== undefined && attached.has(target);
  const guest = useGuestNavigation(isAttached ? target : null);
  return { guest: isAttached ? guest : undefined, target };
}
