import { tabsAtom } from "@/client/atoms/tabs";
import { TabProvider } from "@/client/components/tab-context";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { setTabPathname } from "@/client/lib/tab-model";
import { createTabRouter, sharedQueryClient } from "@/client/lib/tab-router";
import { type Tab } from "@/shared/tabs";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { Activity, useEffect, useState } from "react";

const IconContextValue: IconProps = {
  weight: "bold",
};

/**
 * The whole main-window UI in a single web contents: every open tab kept mounted
 * via {@link TabView}, only the active one visible. Tab state is the renderer
 * {@link tabsAtom}, shared across all tabs since they share this JS context. The
 * chrome (toolbar/tab bar/sidebar) lives inside each tab's `_app`.
 */
export function AppShell() {
  const { model } = useTabsController();

  return (
    <QueryClientProvider client={sharedQueryClient}>
      <IconContext.Provider value={IconContextValue}>
        <div className="relative h-screen w-full overflow-hidden">
          {model.tabs.map((tab) => (
            <TabView
              isActive={tab.id === model.selectedId}
              key={tab.id}
              tab={tab}
            />
          ))}
        </div>
      </IconContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * One open tab: its own router (own memory history + route state) created once
 * for the component's lifetime and wrapped in <Activity>. Hidden tabs stay
 * mounted, so scroll/selection/per-tab history survive and switching is a DOM
 * show/hide -- no compositor reveal, no flicker. The per-tab router renders
 * `_app`, which renders that tab's full shell (toolbar + sidebar + content).
 */
function TabView({ isActive, tab }: { isActive: boolean; tab: Tab }) {
  const [router] = useState(() => createTabRouter({ pathname: tab.pathname }));
  const setTabs = useSetAtom(tabsAtom);

  useEffect(() => {
    // Mirror this tab's navigation back into the model so the tab bar reflects
    // the current location (title/icon are reported separately via useTabMeta).
    const unsubscribe = router.subscribe("onResolved", () => {
      setTabs((model) =>
        setTabPathname(model, {
          id: tab.id,
          pathname: router.state.location.href,
        }),
      );
    });
    return unsubscribe;
  }, [router, setTabs, tab.id]);

  return (
    <TabProvider value={tab.id}>
      <Activity mode={isActive ? "visible" : "hidden"}>
        <div className="absolute inset-0">
          <RouterProvider router={router} />
        </div>
      </Activity>
    </TabProvider>
  );
}
