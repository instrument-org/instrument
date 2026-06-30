import { tabsAtom } from "@/client/atoms/tabs";
import { clampZoom, ZOOM_STEP, zoomAtom } from "@/client/atoms/zoom";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useMouseBackForward } from "@/client/hooks/use-mouse-back-forward";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { readRouterTabMeta } from "@/client/lib/router-tab-meta";
import {
  addTab,
  closeTab,
  reopenClosed,
  selectAdjacent,
  selectByIndex,
  setTabMeta,
  setTabPathname,
} from "@/client/lib/tab-model";
import { createTabRouter, sharedQueryClient } from "@/client/lib/tab-router";
import {
  getTabHistory,
  getTabRouter,
  registerTabRouter,
  unregisterTabRouter,
} from "@/client/lib/tab-router-registry";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Tab } from "@/shared/tabs";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useState } from "react";

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
  const zoom = useAtomValue(zoomAtom);

  useMouseBackForward();

  // Apply tab commands from the main process (menus, overlay-initiated opens),
  // streamed over RPC. One subscription owns the whole tab command surface.
  useEffect(() => {
    let cancelled = false;

    async function subscribe() {
      const subscription = await rpcClient.tabs.live.commands.call();
      for await (const command of subscription) {
        if (cancelled) {
          break;
        }
        switch (command.type) {
          case "close": {
            const id = command.id ?? store.get(tabsAtom).selectedId;
            if (id) {
              store.set(tabsAtom, (m) =>
                closeTab(m, {
                  history: getTabHistory(id),
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
          case "navigateBack": {
            getTabRouter(store.get(tabsAtom).selectedId)?.history.back();
            break;
          }
          case "navigateForward": {
            getTabRouter(store.get(tabsAtom).selectedId)?.history.forward();
            break;
          }
          case "reopen": {
            store.set(tabsAtom, (m) => reopenClosed(m, { id: freshId() }));
            break;
          }
          case "selectByIndex": {
            store.set(tabsAtom, (m) =>
              selectByIndex(m, { index: command.index }),
            );
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
          case "zoomIn": {
            store.set(zoomAtom, (z) => clampZoom(z + ZOOM_STEP));
            break;
          }
          case "zoomOut": {
            store.set(zoomAtom, (z) => clampZoom(z - ZOOM_STEP));
            break;
          }
          case "zoomReset": {
            store.set(zoomAtom, 1);
            break;
          }
        }
      }
    }

    void subscribe();

    return () => {
      cancelled = true;
    };
  }, [store]);

  return (
    <QueryClientProvider client={sharedQueryClient}>
      <IconContext.Provider value={IconContextValue}>
        <div
          className="relative overflow-hidden"
          style={
            {
              "--app-zoom": zoom,
              // `zoom` rescales the box, so divide the viewport sizing by the same
              // factor to keep the shell covering exactly the real viewport.
              height: "calc(100vh / var(--app-zoom))",
              width: "calc(100vw / var(--app-zoom))",
              zoom: "var(--app-zoom)",
            } as React.CSSProperties
          }
        >
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
 * for the component's lifetime. Every tab stays mounted and fully live -- it
 * loads its data, runs its subscriptions, and keeps background agents updating --
 * rather than being paused by `<Activity>`. Inactive tabs are hidden with CSS
 * `visibility` (not `display:none`), which preserves scroll, keeps effects
 * running, and avoids re-rendering from a zero state when first shown. Switching
 * is a CSS toggle in one web contents, so there's no flicker. The per-tab router
 * renders `_app`, which renders that tab's full shell (toolbar/sidebar/content).
 */
function TabView({ isActive, tab }: { isActive: boolean; tab: Tab }) {
  const [router] = useState(() =>
    createTabRouter({ history: tab.history, pathname: tab.pathname }),
  );
  const setTabs = useSetAtom(tabsAtom);

  useEffect(() => {
    // Registered so the main process (menus/overlay) can navigate the active
    // tab's router over the tab-command IPC.
    registerTabRouter(tab.id, router);
    // Mirror this tab's navigation back into the model so the tab bar reflects
    // the current location, and pull the title/icon from the route's head meta.
    const unsubscribe = router.subscribe("onResolved", () => {
      const meta = readRouterTabMeta(router);
      setTabs((model) => {
        const withPathname = setTabPathname(model, {
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
      <ActiveTabProvider isActive={isActive}>
        <RouterProvider router={router} />
      </ActiveTabProvider>
    </div>
  );
}
