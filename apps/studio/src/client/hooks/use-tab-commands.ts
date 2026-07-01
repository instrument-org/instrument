import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { tabsAtom } from "@/client/atoms/tabs";
import { clampZoom, ZOOM_STEP, zoomAtom } from "@/client/atoms/zoom";
import {
  addTab,
  closeTab,
  reopenClosed,
  selectAdjacent,
  selectByIndex,
} from "@/client/lib/tab-model";
import { getTabHistory, getTabRouter } from "@/client/lib/tab-router-registry";
import { rpcClient } from "@/client/rpc/client";
import { useStore } from "jotai";
import { sleep } from "radashi";
import { useEffect } from "react";

const NEW_TAB_PATH = "/new-tab";

// Tab commands that move the user between tabs or routes. While a modal is open
// these are ignored so shortcuts like Cmd+T / Cmd+W can't pull the user out from
// under it; zoom commands stay allowed since they don't navigate.
const MODAL_BLOCKED_COMMANDS = new Set([
  "close",
  "navigate",
  "navigateBack",
  "navigateForward",
  "reopen",
  "selectByIndex",
  "selectLast",
  "selectNext",
  "selectPrevious",
]);

// Backoff before re-establishing a dropped command stream, so a transport reset
// (e.g. a renderer hot reload) doesn't spin.
const RECONNECT_DELAY_MS = 500;

/**
 * Applies imperative tab commands from the main process (menus,
 * modal-initiated opens), streamed over RPC, to the renderer-owned tab state.
 * One subscription owns the whole tab command surface: it aborts deterministically
 * on unmount and reconnects if the stream drops, so a hot reload (or any
 * transient transport reset) can't leave the hotkeys unwired.
 */
export function useTabCommands() {
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
              MODAL_BLOCKED_COMMANDS.has(command.type) &&
              store.get(blockingModalCountAtom) > 0
            ) {
              continue;
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

function freshId() {
  return crypto.randomUUID();
}
