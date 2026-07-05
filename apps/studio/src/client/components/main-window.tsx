import { tabsAtom } from "@/client/atoms/tabs";
import { zoomAtom } from "@/client/atoms/zoom";
import { AppChrome } from "@/client/components/app-chrome";
import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { ErrorBoundary } from "@/client/components/error-boundary";
import { ZoomToast } from "@/client/components/zoom-controls";
import { ZoomRoot } from "@/client/components/zoom-root";
import {
  ActiveTabProvider,
  TabIdProvider,
} from "@/client/hooks/use-active-tab";
import { useAppCommands } from "@/client/hooks/use-app-commands";
import { useMouseBackForward } from "@/client/hooks/use-mouse-back-forward";
import { PortalContainerProvider } from "@/client/hooks/use-portal-container";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { readRouterTabMeta } from "@/client/lib/router-tab-meta";
import {
  createTabRouter,
  sharedQueryClient,
  type TabRouter,
} from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import {
  getTabRouter,
  getTabRouters,
  pruneTabRouters,
  setTabRouter,
} from "@/client/lib/tab-router-registry";
import { setTabMeta, setTabPathname } from "@/client/lib/tabs-model";
import { capturePageView } from "@/client/lib/telemetry";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Tab } from "@/shared/tabs";
import { safe } from "@orpc/client";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, RouterProvider } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

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
export function MainWindow() {
  const { model } = useTabsController();
  const zoom = useAtomValue(zoomAtom);
  const routers = useTabRouters(model.tabs);
  const activeRouter = model.selectedId
    ? routers.get(model.selectedId)
    : undefined;

  useMouseBackForward();
  useAppCommands();

  // Keep the macOS traffic-light position in sync with the main-window zoom (the
  // toolbar height scales with it). Only the main window renders MainWindow, so
  // this stays out of the zoom atom (which the onboarding window also imports).
  useEffect(() => {
    void safe(rpcClient.utils.syncZoom.call({ zoom }));
  }, [zoom]);

  return (
    <QueryClientProvider client={sharedQueryClient}>
      <ThemeProvider>
        {/* The one TooltipProvider for the unified main window. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <TooltipProvider>
          <ErrorBoundary FallbackComponent={AppErrorFallback}>
            <IconContext.Provider value={IconContextValue}>
              <ZoomRoot>
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
              </ZoomRoot>
              <ZoomToast />
            </IconContext.Provider>
          </ErrorBoundary>
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
    // Mirror this tab's navigation back into the model so the tab bar reflects
    // the current location, and pull the title/icon from the route's head meta.
    const unsubscribe = router.subscribe("onResolved", () => {
      // Each tab's navigation is a product page view; the shared web contents no
      // longer fires the router.tsx onRendered capture (that router is onboarding
      // only), so emit it here with the tab's own path.
      capturePageView(router.state.location.href);
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
      <PortalContainerProvider>
        <TabIdProvider id={tab.id}>
          <ActiveTabProvider isActive={isActive}>
            <RouterProvider router={router} />
          </ActiveTabProvider>
        </TabIdProvider>
      </PortalContainerProvider>
    </div>
  );
}

/**
 * Backs each open tab with a router from the shared registry: created lazily on
 * first appearance (synchronously, so MainWindow can hand the active tab's
 * router to the chrome on first paint) and pruned when the tab closes. The
 * registry is the single owner, so the chrome and the app-command bus read the
 * same routers via `getTabRouter`.
 */
function useTabRouters(tabs: Tab[]) {
  for (const tab of tabs) {
    if (!getTabRouter(tab.id)) {
      setTabRouter(
        tab.id,
        createTabRouter({ history: tab.history, pathname: tab.pathname }),
      );
    }
  }

  // `tabs` changes reference only when the tab set changes (add/remove/reorder),
  // so this prunes exactly then -- including speculative routers left by an
  // abandoned transition render, since effects run only on commit.
  useEffect(() => {
    pruneTabRouters(new Set(tabs.map((tab) => tab.id)));
  }, [tabs]);

  return getTabRouters();
}
