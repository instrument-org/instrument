import { tabsAtom } from "@/client/atoms/tabs";
import { TabProvider } from "@/client/components/tab-context";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import {
  addTab,
  closeTab,
  reopenClosed,
  selectAdjacent,
  selectByIndex,
  setTabPathname,
} from "@/client/lib/tab-model";
import { createTabRouter, sharedQueryClient } from "@/client/lib/tab-router";
import {
  getTabRouter,
  registerTabRouter,
  unregisterTabRouter,
} from "@/client/lib/tab-router-registry";
import { type Tab } from "@/shared/tabs";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import { Activity, useEffect, useState } from "react";

const IconContextValue: IconProps = {
  weight: "bold",
};

const NEW_TAB_PATH = "/new-tab";

/**
 * The whole main-window UI in a single web contents: every open tab kept mounted
 * via {@link TabView}, only the active one visible. Tab state is the renderer
 * {@link tabsAtom}, shared across all tabs since they share this JS context. The
 * chrome (toolbar/tab bar/sidebar) lives inside each tab's `_app`.
 */
export function AppShell() {
  const { model } = useTabsController();
  const store = useStore();

  // Apply tab commands from the main process (menus, overlay-initiated opens).
  useEffect(() => {
    return window.api.onTabCommand((command) => {
      switch (command.type) {
        case "close": {
          const id = command.id ?? store.get(tabsAtom).selectedId;
          if (id) {
            store.set(tabsAtom, (m) =>
              closeTab(m, {
                id,
                newTab: { id: freshId(), pathname: NEW_TAB_PATH },
              }),
            );
          }
          break;
        }
        case "navigate": {
          if (command.newTab) {
            store.set(tabsAtom, (m) =>
              addTab(m, { id: freshId(), pathname: command.appPath }),
            );
            break;
          }
          const router = getTabRouter(store.get(tabsAtom).selectedId);
          if (router) {
            void router.navigate({
              to: command.appPath,
            } as Parameters<typeof router.navigate>[0]);
          }
          break;
        }
        case "reopen": {
          store.set(tabsAtom, (m) => reopenClosed(m, { id: freshId() }));
          break;
        }
        case "selectByIndex": {
          store.set(tabsAtom, (m) => selectByIndex(m, { index: command.index }));
          break;
        }
        case "selectLast": {
          store.set(tabsAtom, (m) =>
            selectByIndex(m, { index: m.tabs.length - 1 }),
          );
          break;
        }
        case "selectNext": {
          store.set(tabsAtom, (m) => selectAdjacent(m, { delta: 1 }));
          break;
        }
        case "selectPrevious": {
          store.set(tabsAtom, (m) => selectAdjacent(m, { delta: -1 }));
          break;
        }
      }
    });
  }, [store]);

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

function freshId() {
  return crypto.randomUUID();
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
    // Registered so the main process (menus/overlay) can navigate the active
    // tab's router over the tab-command IPC.
    registerTabRouter(tab.id, router);
    // Mirror this tab's navigation back into the model so the tab bar reflects
    // the current location.
    const unsubscribe = router.subscribe("onResolved", () => {
      setTabs((model) =>
        setTabPathname(model, {
          id: tab.id,
          pathname: router.state.location.href,
        }),
      );
    });
    return () => {
      unsubscribe();
      unregisterTabRouter(tab.id);
    };
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
