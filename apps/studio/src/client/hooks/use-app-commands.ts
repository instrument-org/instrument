import { toggleCommandMenu } from "@/client/atoms/command-menu";
import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { tabsAtom } from "@/client/atoms/tabs";
import { ZOOM_MAX, ZOOM_MIN, zoomAtom } from "@/client/atoms/zoom";
import { toggleSidebar } from "@/client/hooks/use-sidebar";
import { requestBrowserFind } from "@/client/lib/browser-find-registry";
import { closeSelectedTab, openTab, reopenTab } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import {
  selectAdjacent,
  selectByIndex,
  selectTab,
} from "@/client/lib/tabs-model";
import { resolveTaskFocusAction } from "@/client/lib/task-focus-action";
import { rpcClient } from "@/client/rpc/client";
import { type AppCommand } from "@/shared/app-command";
import { steppedZoom } from "@/shared/zoom";
import { StoreId } from "@instrument-org/workspace/client";
import { useStore } from "jotai";
import { sleep } from "radashi";
import { useEffect } from "react";

// Commands allowed to run while a blocking modal is open: they drive app-wide
// view state (settings, command menu, sidebar, zoom, reload), never the tab
// stack, so they can't pull the user out from under a modal. Everything else
// (open/close/switch/navigate) is blocked. Allow-list, not deny-list, so a new
// command is blocked by default until it's explicitly marked modal-safe.
const MODAL_SAFE_COMMANDS = new Set<AppCommand["type"]>([
  "openSettings",
  "openShortcutGuide",
  "reload",
  "setTheme",
  "toggleCommandMenu",
  "toggleSidebar",
  "zoomIn",
  "zoomOut",
  "zoomReset",
]);

// Backoff before re-establishing a dropped command stream, so a transport reset
// (e.g. a renderer hot reload) doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Applies imperative app commands from the main process (native menus /
 * accelerators), streamed over RPC, to the renderer-owned tab and app state.
 * One subscription owns the whole command surface: it aborts deterministically
 * on unmount and reconnects if the stream drops, so a hot reload (or any
 * transient transport reset) can't leave the hotkeys unwired.
 *
 * Updates are applied directly, not wrapped in `startTransition`: React warns
 * about transitions driven by an async subscription's update bursts. The
 * tab-switch transition for UI-originated actions lives in `useTabsController`.
 */
export function useAppCommands() {
  const store = useStore();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      while (true) {
        if (signal.aborted) {
          return;
        }
        try {
          const commands = await rpcClient.appCommands.events.command.call(
            undefined,
            { signal },
          );
          for await (const command of commands) {
            if (
              !MODAL_SAFE_COMMANDS.has(command.type) &&
              store.get(blockingModalCountAtom) > 0
            ) {
              continue;
            }
            switch (command.type) {
              case "close": {
                store.set(tabsAtom, closeSelectedTab);
                break;
              }
              case "findInPage": {
                requestBrowserFind();
                break;
              }
              case "focusTask": {
                const model = store.get(tabsAtom);
                const action = resolveTaskFocusAction({
                  model,
                  readSelectedSessionId: (tabId) => {
                    const search = getTabRouter(tabId)?.state.location.search;
                    const parsed = StoreId.SessionSchema.safeParse(
                      search?.selectedSessionId,
                    );
                    return parsed.success ? parsed.data : undefined;
                  },
                  sessionId: command.sessionId,
                  taskId: command.id,
                });
                if (!action) {
                  break;
                }

                const router = getTabRouter(action.tabId);
                if (!router) {
                  break;
                }
                if (action.type === "navigateTaskTab") {
                  void router.navigate({
                    from: "/tasks/$id/",
                    params: { id: command.id },
                    search: (prev) => ({
                      ...prev,
                      selectedSessionId: command.sessionId,
                    }),
                    to: "/tasks/$id",
                  });
                } else if (action.type === "navigateSelectedTab") {
                  void router.navigate({
                    params: { id: command.id },
                    search: { selectedSessionId: command.sessionId },
                    to: "/tasks/$id",
                  });
                }
                store.set(tabsAtom, (current) =>
                  selectTab(current, { id: action.tabId }),
                );
                break;
              }
              case "navigate": {
                const router = getTabRouter(store.get(tabsAtom).selectedId);
                // `to` is a typed StudioPath; params/search are loose IPC data,
                // so cast the combined target to the router's options here.
                const target = {
                  params: command.params,
                  search: command.search,
                  to: command.to,
                };
                if (command.newTab) {
                  const pathname = router
                    ? router.buildLocation(
                        target as Parameters<typeof router.buildLocation>[0],
                      ).href
                    : command.to;
                  store.set(tabsAtom, (m) => openTab(m, { pathname }));
                  break;
                }
                if (router) {
                  void router.navigate(
                    target as Parameters<typeof router.navigate>[0],
                  );
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
              case "openSettings": {
                openSettings({ tab: "General" });
                break;
              }
              case "openShortcutGuide": {
                openShortcutGuide();
                break;
              }
              case "reload": {
                window.location.reload();
                break;
              }
              case "reopen": {
                store.set(tabsAtom, reopenTab);
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
              case "setTheme": {
                void rpcClient.preferences.setTheme.call({
                  theme: command.theme,
                });
                break;
              }
              case "toggleCommandMenu": {
                toggleCommandMenu();
                break;
              }
              case "toggleSidebar": {
                toggleSidebar();
                break;
              }
              case "zoomIn": {
                store.set(zoomAtom, (z) =>
                  steppedZoom({
                    direction: "in",
                    factor: z,
                    max: ZOOM_MAX,
                    min: ZOOM_MIN,
                  }),
                );
                break;
              }
              case "zoomOut": {
                store.set(zoomAtom, (z) =>
                  steppedZoom({
                    direction: "out",
                    factor: z,
                    max: ZOOM_MAX,
                    min: ZOOM_MIN,
                  }),
                );
                break;
              }
              case "zoomReset": {
                store.set(zoomAtom, 1);
                break;
              }
              default: {
                command satisfies never;
              }
            }
          }
        } catch {
          // Stream dropped (transport reset, hot reload); reconnect below unless
          // we're tearing down.
        }
        await sleep(RECONNECT_DELAY_MS);
      }
    }

    void run();

    return () => {
      controller.abort();
    };
  }, [store]);
}
