import { toggleCommandMenu } from "@/client/atoms/command-menu";
import { openSettings } from "@/client/atoms/settings-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { tabsAtom } from "@/client/atoms/tabs";
import { clampZoom, ZOOM_STEP, zoomAtom } from "@/client/atoms/zoom";
import { toggleSidebar } from "@/client/hooks/use-sidebar";
import { closeSelectedTab, openTab, reopenTab } from "@/client/lib/tab-actions";
import { selectAdjacent, selectByIndex } from "@/client/lib/tab-model";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { rpcClient } from "@/client/rpc/client";
import { type AppCommand } from "@/shared/tabs";
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
  "reload",
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
          const commands = await rpcClient.tabs.live.commands.call(undefined, {
            signal,
          });
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
              case "navigate": {
                if (command.newTab) {
                  store.set(tabsAtom, (m) =>
                    openTab(m, { pathname: command.appPath }),
                  );
                  break;
                }
                const router = getTabRouter(store.get(tabsAtom).selectedId);
                if (router) {
                  // appPath is an unvalidated route string from the main process
                  // (menus/onboarding), so it can't satisfy the typed route graph
                  // statically; assert it here at that trust boundary.
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
              case "openSettings": {
                openSettings({ tab: "General" });
                break;
              }
              case "reload": {
                // Gated on the *active* tab's route so a backgrounded task
                // can't suppress reload and a foregrounded one can.
                const router = getTabRouter(store.get(tabsAtom).selectedId);
                const disableHotkeyReload = router?.state.matches.some(
                  (match) => match.context.disableHotkeyReload,
                );
                if (!disableHotkeyReload) {
                  window.location.reload();
                }
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
              case "toggleCommandMenu": {
                toggleCommandMenu();
                break;
              }
              case "toggleSidebar": {
                toggleSidebar();
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
