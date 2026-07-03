import { tabsAtom } from "@/client/atoms/tabs";
import { zoomAtom } from "@/client/atoms/zoom";
import { AppChrome } from "@/client/components/app-chrome";
import {
  ActiveTabProvider,
  TabIdProvider,
} from "@/client/hooks/use-active-tab";
import { useMouseBackForward } from "@/client/hooks/use-mouse-back-forward";
import { useTabCommands } from "@/client/hooks/use-tab-commands";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { readRouterTabMeta } from "@/client/lib/router-tab-meta";
import { setTabMeta, setTabPathname } from "@/client/lib/tab-model";
import {
  createTabRouter,
  sharedQueryClient,
  type TabRouter,
} from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import {
  registerTabRouter,
  unregisterTabRouter,
} from "@/client/lib/tab-router-registry";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Tab } from "@/shared/tabs";
import { safe } from "@orpc/client";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, RouterProvider } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { ThemeProvider } from "./theme-provider";
import { TooltipProvider } from "./ui/tooltip";

const IconContextValue: IconProps = {
  weight: "bold",
};

/**
 * The whole main-window UI in a single web contents. The chrome (toolbar, tab
 * bar, sidebar) is rendered once by {@link AppChrome} and reads the active tab's
 * router from context, so it never remounts when tabs switch. Each open tab is
 * kept mounted via {@link TabView}; only the active one is visible. Tab state is
 * the renderer {@link tabsAtom}, shared across all tabs in this JS context.
 */
export function AppShell() {
  const { model } = useTabsController();
  const zoom = useAtomValue(zoomAtom);
  const routers = useTabRouters(model.tabs);
  const activeRouter = model.selectedId
    ? routers.get(model.selectedId)
    : undefined;

  useMouseBackForward();
  useTabCommands();

  // Keep the macOS traffic-light position in sync with the shell zoom (the
  // toolbar height scales with it). Only the main window renders AppShell, so
  // this stays out of the zoom atom (which the onboarding window also imports).
  useEffect(() => {
    void safe(rpcClient.utils.syncZoom.call({ zoom }));
  }, [zoom]);

  return (
    <QueryClientProvider client={sharedQueryClient}>
      <ThemeProvider>
        {/* The one TooltipProvider for the unified shell. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <TooltipProvider>
          <IconContext.Provider value={IconContextValue}>
            <div
              className="relative overflow-hidden"
              style={
                {
                  "--app-zoom": zoom,
                  // `zoom` rescales the box, so divide the viewport sizing by the
                  // same factor to keep the shell covering the real viewport.
                  height: "calc(100vh / var(--app-zoom))",
                  width: "calc(100vw / var(--app-zoom))",
                  zoom: "var(--app-zoom)",
                } as React.CSSProperties
              }
            >
              {activeRouter ? (
                <RouterContextProvider router={activeRouter}>
                  <AppChrome>
                    {model.tabs.map((tab) => {
                      const router = routers.get(tab.id);
                      if (!router) {
                        return null;
                      }
                      return (
                        <TabView
                          isActive={tab.id === model.selectedId}
                          key={tab.id}
                          router={router}
                          tab={tab}
                        />
                      );
                    })}
                  </AppChrome>
                </RouterContextProvider>
              ) : null}
            </div>
          </IconContext.Provider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * One open tab: every tab stays mounted and fully live -- it loads its data,
 * runs its subscriptions, and keeps background agents updating -- rather than
 * being paused. Inactive tabs are hidden with CSS `visibility` (not
 * `display:none`), which preserves scroll, keeps effects running, and avoids
 * re-rendering from a zero state when first shown. Switching is a CSS toggle in
 * one web contents, so there's no flicker.
 */
function TabView({
  isActive,
  router,
  tab,
}: {
  isActive: boolean;
  router: TabRouter;
  tab: Tab;
}) {
  const setTabs = useSetAtom(tabsAtom);

  useEffect(() => {
    // Registered so the main process (menus / keyboard shortcuts) can navigate
    // the active tab's router over the tab-command IPC.
    registerTabRouter(tab.id, router);
    // Mirror this tab's navigation back into the model so the tab bar reflects
    // the current location, and pull the title/icon from the route's head meta.
    const unsubscribe = router.subscribe("onResolved", () => {
      const meta = readRouterTabMeta(router);
      setTabs((model) => {
        const withPathname = setTabPathname(model, {
          history: getRouterHistory(router),
          id: tab.id,
          pathname: router.state.location.href,
        });
        return setTabMeta(withPathname, {
          iconName: meta.iconName,
          id: tab.id,
          taskId: meta.taskId,
          title: meta.title,
        });
      });
    });
    return () => {
      unsubscribe();
      unregisterTabRouter(tab.id);
    };
  }, [router, setTabs, tab.id]);

  return (
    <div
      className={cn(
        "absolute inset-0",
        // `visibility: hidden` alone doesn't reliably tear down a promoted
        // compositor layer (e.g. the artifact panel's slide-in transform), so a
        // backgrounded tab can leave a stale layer painted over the active one.
        // Zeroing opacity forces a transparent composite and guarantees it's
        // gone, while keeping the tab mounted (scroll/effects/agents preserved).
        isActive ? "visible" : "invisible opacity-0",
      )}
    >
      <TabIdProvider id={tab.id}>
        <ActiveTabProvider isActive={isActive}>
          <RouterProvider router={router} />
        </ActiveTabProvider>
      </TabIdProvider>
    </div>
  );
}

/**
 * Owns one router per open tab, keyed by tab id, for the lifetime of the window.
 * Routers are created lazily on first appearance and pruned when their tab
 * closes, so AppShell can hand the active tab's router to the chrome
 * synchronously (no registry round-trip on first paint).
 */
function useTabRouters(tabs: Tab[]) {
  const [routers] = useState(() => new Map<string, TabRouter>());

  for (const tab of tabs) {
    if (!routers.has(tab.id)) {
      routers.set(
        tab.id,
        createTabRouter({ history: tab.history, pathname: tab.pathname }),
      );
    }
  }

  const liveIds = tabs.map((tab) => tab.id).join("\n");
  useEffect(() => {
    const live = new Set(liveIds.split("\n"));
    for (const id of routers.keys()) {
      if (!live.has(id)) {
        routers.delete(id);
      }
    }
  }, [liveIds, routers]);

  return routers;
}
