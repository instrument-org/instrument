import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { useAppTabs } from "@/client/components/window/app-tabs";
import {
  matchScreen,
  SCREEN_ROUTES,
} from "@/client/components/window/window-href";
import { wantsNewTab } from "@/client/hooks/use-open-target";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useRouterState } from "@tanstack/react-router";

/**
 * Activity from anywhere in the window: the tab already showing it comes up,
 * or a tab of its own opens, except over a new tab, which becomes Activity.
 * On Activity itself it goes back to the start, every row and no search,
 * which is what pressing it again is for.
 */
export function useShowActivity() {
  const appTabs = useAppTabs();
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  return ({ newTab = false }: { newTab?: boolean } = {}) => {
    const up = matchScreen(activeHref).kind;
    if (newTab) {
      appTabs.open(SCREEN_ROUTES.activity, { newTab: true });
    } else if (up === "activity" || up === "newTab") {
      // A new tab is somewhere to go rather than something to keep.
      appTabs.navigate(SCREEN_ROUTES.activity);
    } else {
      appTabs.open(SCREEN_ROUTES.activity);
    }
  };
}

/** The window corner's way into Activity, beside the bell. */
export function ActivityButton() {
  const showActivity = useShowActivity();
  return (
    <ToolbarTooltip chord="showActivity" label="Activity">
      <Button
        // The bell's grey, beside it.
        className="size-7 text-muted-foreground/70 [-webkit-app-region:no-drag]"
        onClick={(event) => {
          showActivity({ newTab: wantsNewTab(event) });
        }}
        size="icon-sm"
        variant="ghost-toolbar"
      >
        <ClockCounterClockwiseIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
